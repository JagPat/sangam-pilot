import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the organizer's guest + invitation management screen (/host/manage). Everything runs
// under the owner's own session (RLS), scoped to the weddings they own. This is READ ONLY; mutations go
// through the server actions in app/host/manage/actions.ts (owner-session inserts/updates the owner_write
// RLS policies already permit — no service role).

export type ManageEvent = {
  eventInstanceId: string;
  functionName: string | null;
  functionType: string | null;
  whenInstant: string | null;
  tz: string;
};

export type ManageGuest = {
  guestId: string;
  guestName: string | null;
  householdId: string;
  householdName: string | null;
  email: string | null;
  bound: boolean; // has signed in and been linked to their account
  invited: Record<string, boolean>; // eventInstanceId -> invited?
  locked: Record<string, boolean>; // eventInstanceId -> already responded (cannot be un-invited)
};

export type ManageHousehold = { id: string; name: string };

export type ManageWedding = {
  weddingId: string;
  title: string;
  households: ManageHousehold[];
  events: ManageEvent[];
  guests: ManageGuest[];
};

export async function getManageData(db: AppSupabaseClient): Promise<ManageWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, households, guests, contacts, insts, funcs, igs, att] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('household').select('id, wedding_id, name').in('wedding_id', weddingIds),
    app.from('guest').select('id, wedding_id, household_id, full_name, self_account_id').in('wedding_id', weddingIds),
    app.from('household_contact').select('wedding_id, guest_id, channel, value').in('wedding_id', weddingIds).eq('channel', 'email'),
    app.from('event_instance').select('id, wedding_id, event_function_id, iana_timezone, arrival').in('wedding_id', weddingIds),
    app.from('event_function').select('id, wedding_id, name, type').in('wedding_id', weddingIds),
    app.from('invitation_guest').select('id, wedding_id, event_instance_id, guest_id').in('wedding_id', weddingIds),
    app.from('event_attendance').select('invitation_guest_id, wedding_id').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, households, guests, contacts, insts, funcs, igs, att]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((f) => [f.id, f]));
  const emailByGuest = new Map<string, string>();
  for (const c of contacts.data ?? []) if (c.guest_id && !emailByGuest.has(c.guest_id)) emailByGuest.set(c.guest_id, c.value);
  const respondedIg = new Set((att.data ?? []).map((a) => a.invitation_guest_id));

  return (weds.data ?? []).map((w) => {
    const wHouse: ManageHousehold[] = (households.data ?? [])
      .filter((h) => h.wedding_id === w.id)
      .map((h) => ({ id: h.id, name: h.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const events: ManageEvent[] = (insts.data ?? [])
      .filter((i) => i.wedding_id === w.id)
      .map((i) => {
        const fn = funcById.get(i.event_function_id);
        return {
          eventInstanceId: i.id,
          functionName: fn?.name ?? null,
          functionType: fn?.type ?? null,
          whenInstant: i.arrival?.instant ?? null,
          tz: i.iana_timezone ?? 'UTC',
        };
      })
      .sort((a, b) => (a.whenInstant ?? '').localeCompare(b.whenInstant ?? ''));

    const wIgs = (igs.data ?? []).filter((ig) => ig.wedding_id === w.id);

    const guestsOut: ManageGuest[] = (guests.data ?? [])
      .filter((g) => g.wedding_id === w.id)
      .map((g) => {
        const invited: Record<string, boolean> = {};
        const locked: Record<string, boolean> = {};
        for (const ev of events) {
          const ig = wIgs.find((x) => x.guest_id === g.id && x.event_instance_id === ev.eventInstanceId);
          invited[ev.eventInstanceId] = !!ig;
          locked[ev.eventInstanceId] = ig ? respondedIg.has(ig.id) : false;
        }
        const hh = wHouse.find((h) => h.id === g.household_id);
        return {
          guestId: g.id,
          guestName: g.full_name ?? null,
          householdId: g.household_id,
          householdName: hh?.name ?? null,
          email: emailByGuest.get(g.id) ?? null,
          bound: !!g.self_account_id,
          invited,
          locked,
        };
      })
      .sort((a, b) => (a.guestName ?? '').localeCompare(b.guestName ?? ''));

    return { weddingId: w.id, title: w.title, households: wHouse, events, guests: guestsOut };
  });
}
