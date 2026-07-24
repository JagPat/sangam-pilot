import type { AppSupabaseClient } from '../supabase/clients';
import { getOperatorContext } from './owner';

// Read model for the organizer's guest + invitation management screen (/host/manage). Everything runs
// under the signed-in user's own session (RLS). The OWNER sees the whole guest list; a bride/groom-side
// FAMILY ADMIN sees only their side — the row scoping is enforced by the RLS policies in migration 0016,
// not here. This is READ ONLY; mutations go through the server actions in app/host/manage/actions.ts.

export type ManageEvent = {
  eventInstanceId: string;
  functionName: string | null;
  functionType: string | null;
  whenInstant: string | null;
  tz: string;
};

// Dietary vocabulary (mirrors the app.dietary_category / app.jain_strictness enums in 0005_food.sql).
// Kept here so the organizer form and the loader share one source of truth.
export const DIETARY_CATEGORIES = [
  { value: 'veg', label: 'Vegetarian' },
  { value: 'jain', label: 'Jain' },
  { value: 'swaminarayan', label: 'Swaminarayan' },
  { value: 'vaishnav', label: 'Vaishnav' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'nonveg', label: 'Non-vegetarian' },
] as const;

export const JAIN_STRICTNESS = [
  { value: 'standard', label: 'Standard' },
  { value: 'no_root_veg', label: 'No root vegetables' },
  { value: 'no_after_sunset', label: 'Nothing after sunset' },
  { value: 'no_honey', label: 'No honey' },
] as const;

export type GuestDietary = {
  category: string | null; // null = no profile recorded yet
  jainStrictness: string | null;
  noOnionGarlic: boolean;
  allergies: string | null;
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
  dietary: GuestDietary; // caterer-facing needs; category null until the host (or guest) records it
  showInDirectory: boolean; // listed in the consent-respecting guest directory ("Who's coming")
};

export type ManageHousehold = { id: string; name: string; hostGroupId: string | null };
export type ManageSide = { id: string; name: string; kind: string };

export type ManageWedding = {
  weddingId: string;
  title: string;
  households: ManageHousehold[];
  sides: ManageSide[]; // the wedding's host groups (bride/groom/…), for assigning a household to a side
  events: ManageEvent[];
  guests: ManageGuest[];
  viewerIsOwner: boolean; // owner: sees everything + can assign sides. admin: their side only.
  viewerGroupId: string | null; // for a family admin, the side they manage (RLS already scopes the rows)
};

export async function getManageData(db: AppSupabaseClient): Promise<ManageWedding[]> {
  const app = db.schema('app');
  const ctx = await getOperatorContext(db);
  const weddingIds = ctx.ids;
  if (weddingIds.length === 0) return [];

  const [weds, households, sides, guests, contacts, insts, funcs, igs, att, diets] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('household').select('id, wedding_id, name, host_group_id').in('wedding_id', weddingIds),
    app.from('host_group').select('id, wedding_id, kind, name').in('wedding_id', weddingIds),
    app.from('guest').select('id, wedding_id, household_id, full_name, self_account_id, show_in_directory').in('wedding_id', weddingIds),
    app.from('household_contact').select('wedding_id, guest_id, channel, value').in('wedding_id', weddingIds).eq('channel', 'email'),
    app.from('event_instance').select('id, wedding_id, event_function_id, iana_timezone, arrival').in('wedding_id', weddingIds),
    app.from('event_function').select('id, wedding_id, name, type').in('wedding_id', weddingIds),
    app.from('invitation_guest').select('id, wedding_id, event_instance_id, guest_id').in('wedding_id', weddingIds),
    app.from('event_attendance').select('invitation_guest_id, wedding_id').in('wedding_id', weddingIds),
    app.from('guest_dietary_profile').select('wedding_id, guest_id, category, jain_strictness, no_onion_garlic, allergies').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, households, sides, guests, contacts, insts, funcs, igs, att, diets]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((f) => [f.id, f]));
  const emailByGuest = new Map<string, string>();
  for (const c of contacts.data ?? []) if (c.guest_id && !emailByGuest.has(c.guest_id)) emailByGuest.set(c.guest_id, c.value);
  const respondedIg = new Set((att.data ?? []).map((a) => a.invitation_guest_id));
  const dietByGuest = new Map((diets.data ?? []).map((d) => [d.guest_id, d]));

  return (weds.data ?? []).map((w) => {
    const wHouse: ManageHousehold[] = (households.data ?? [])
      .filter((h) => h.wedding_id === w.id)
      .map((h) => ({ id: h.id, name: h.name, hostGroupId: h.host_group_id ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const wSides: ManageSide[] = (sides.data ?? [])
      .filter((s) => s.wedding_id === w.id)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind }))
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
        const d = dietByGuest.get(g.id);
        return {
          guestId: g.id,
          guestName: g.full_name ?? null,
          householdId: g.household_id,
          householdName: hh?.name ?? null,
          email: emailByGuest.get(g.id) ?? null,
          bound: !!g.self_account_id,
          invited,
          locked,
          showInDirectory: g.show_in_directory ?? true,
          dietary: {
            category: d?.category ?? null,
            jainStrictness: d?.jain_strictness ?? null,
            noOnionGarlic: d?.no_onion_garlic ?? false,
            allergies: d?.allergies ?? null,
          },
        };
      })
      .sort((a, b) => (a.guestName ?? '').localeCompare(b.guestName ?? ''));

    const vctx = ctx.byWedding[w.id] ?? { isOwner: false, adminGroupId: null };
    return {
      weddingId: w.id,
      title: w.title,
      households: wHouse,
      sides: wSides,
      events,
      guests: guestsOut,
      viewerIsOwner: vctx.isOwner,
      viewerGroupId: vctx.adminGroupId,
    };
  });
}
