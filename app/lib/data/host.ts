import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// The organizer (wedding owner) dashboard — READ ONLY. Every query runs under the owner's own session.
// Ownership is established from operator_role (ownedWeddingIds), so the dashboard is correct even before
// any invitations exist. The aggregate views (instance_rsvp_counts / caterer_report / attendance_expanded)
// are owner-scoped by construction (security_invoker + an is_wedding_owner filter). Base tables are read
// under the owner_write/owner-read RLS.

export type EventRollup = {
  eventInstanceId: string;
  functionName: string | null;
  functionType: string | null;
  venueName: string | null;
  tz: string;
  arrivalInstant: string | null;
  accepted: number;
  declined: number;
  tentative: number;
  invited: number;
  noResponse: number;
  dietary: { category: string; headCount: number }[];
};

export type GuestResponse = { eventInstanceId: string; functionName: string | null; status: string };
export type GuestRow = { guestId: string; guestName: string | null; responses: GuestResponse[] };

// Safety-critical dietary detail the per-category head count can't carry: allergies, no onion/garlic,
// Jain strictness. Listed per guest (across the wedding, not per event) so nothing slips past the caterer.
export type SpecialDiet = {
  guestName: string | null;
  category: string;
  jainStrictness: string | null;
  noOnionGarlic: boolean;
  allergies: string | null;
};

export type WeddingDashboard = {
  weddingId: string;
  title: string;
  coupleNames: string | null;
  startDate: string | null;
  endDate: string | null;
  totalGuests: number;
  totalInvitations: number;
  totalResponded: number;
  events: EventRollup[];
  guests: GuestRow[];
  specialDiets: SpecialDiet[];
};

export async function getHostDashboard(db: AppSupabaseClient): Promise<WeddingDashboard[]> {
  const app = db.schema('app');

  // Which weddings does this account own? Robust even before any invitation exists (empty => not an organizer).
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const { data: counts, error: eCounts } = await app
    .from('instance_rsvp_counts')
    .select('wedding_id, event_instance_id, accepted, declined, tentative')
    .in('wedding_id', weddingIds);
  if (eCounts) throw eCounts;

  const [weds, insts, funcs, venues, guests, igs, caterer, att, diets] = await Promise.all([
    app.from('wedding').select('id, title, couple_names, start_date, end_date').in('id', weddingIds),
    app.from('event_instance').select('id, wedding_id, event_function_id, venue_id, iana_timezone, arrival').in('wedding_id', weddingIds),
    app.from('event_function').select('id, name, type').in('wedding_id', weddingIds),
    app.from('venue').select('id, name').in('wedding_id', weddingIds),
    app.from('guest').select('id, wedding_id, full_name').in('wedding_id', weddingIds),
    app.from('invitation_guest').select('id, wedding_id, event_instance_id, guest_id').in('wedding_id', weddingIds),
    app.from('caterer_report').select('wedding_id, event_instance_id, category, head_count').in('wedding_id', weddingIds),
    app.from('attendance_expanded').select('event_instance_id, guest_id, status, wedding_id').in('wedding_id', weddingIds),
    app.from('guest_dietary_profile').select('wedding_id, guest_id, category, jain_strictness, no_onion_garlic, allergies').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, insts, funcs, venues, guests, igs, caterer, att, diets]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((r) => [r.id, r]));
  const venueById = new Map((venues.data ?? []).map((r) => [r.id, r]));
  const instById = new Map((insts.data ?? []).map((r) => [r.id, r]));
  const countsByInst = new Map((counts ?? []).map((r) => [r.event_instance_id, r]));
  const statusByGuestInst = new Map((att.data ?? []).map((r) => [`${r.guest_id}:${r.event_instance_id}`, r.status]));

  const invitedByInst = new Map<string, number>();
  for (const ig of igs.data ?? []) invitedByInst.set(ig.event_instance_id, (invitedByInst.get(ig.event_instance_id) ?? 0) + 1);

  const dietByInst = new Map<string, { category: string; headCount: number }[]>();
  for (const c of caterer.data ?? []) {
    const arr = dietByInst.get(c.event_instance_id) ?? [];
    arr.push({ category: c.category, headCount: Number(c.head_count) });
    dietByInst.set(c.event_instance_id, arr);
  }

  const nameByGuest = new Map((guests.data ?? []).map((g) => [g.id, g.full_name ?? null]));

  return (weds.data ?? []).map((w) => {
    const wInsts = (insts.data ?? []).filter((i) => i.wedding_id === w.id);
    const wGuests = (guests.data ?? []).filter((g) => g.wedding_id === w.id);
    const wIgs = (igs.data ?? []).filter((ig) => ig.wedding_id === w.id);

    const events: EventRollup[] = wInsts
      .map((ei) => {
        const fn = funcById.get(ei.event_function_id);
        const ve = ei.venue_id ? venueById.get(ei.venue_id) : undefined;
        const cnt = countsByInst.get(ei.id);
        const accepted = Number(cnt?.accepted ?? 0);
        const declined = Number(cnt?.declined ?? 0);
        const tentative = Number(cnt?.tentative ?? 0);
        const invited = invitedByInst.get(ei.id) ?? 0;
        const arrival = ei.arrival ?? null;
        return {
          eventInstanceId: ei.id,
          functionName: fn?.name ?? null,
          functionType: fn?.type ?? null,
          venueName: ve?.name ?? null,
          tz: ei.iana_timezone ?? 'UTC',
          arrivalInstant: arrival?.instant ?? null,
          accepted,
          declined,
          tentative,
          invited,
          noResponse: Math.max(0, invited - accepted - declined - tentative),
          dietary: dietByInst.get(ei.id) ?? [],
        };
      })
      .sort((a, b) => (a.arrivalInstant ?? '').localeCompare(b.arrivalInstant ?? ''));

    const guestRows: GuestRow[] = wGuests
      .map((g) => ({
        guestId: g.id,
        guestName: g.full_name ?? null,
        responses: wIgs
          .filter((ig) => ig.guest_id === g.id)
          .map((ig) => ({
            eventInstanceId: ig.event_instance_id,
            functionName: funcById.get(instById.get(ig.event_instance_id)?.event_function_id ?? '')?.name ?? null,
            status: statusByGuestInst.get(`${g.id}:${ig.event_instance_id}`) ?? 'no response',
          })),
      }))
      .sort((a, b) => (a.guestName ?? '').localeCompare(b.guestName ?? ''));

    const totalResponded = (att.data ?? []).filter((a) => wInsts.some((i) => i.id === a.event_instance_id)).length;

    const specialDiets: SpecialDiet[] = (diets.data ?? [])
      .filter((d) => d.wedding_id === w.id && (!!d.allergies?.trim() || d.no_onion_garlic || !!d.jain_strictness))
      .map((d) => ({
        guestName: nameByGuest.get(d.guest_id) ?? null,
        category: d.category,
        jainStrictness: d.jain_strictness ?? null,
        noOnionGarlic: !!d.no_onion_garlic,
        allergies: d.allergies ?? null,
      }))
      .sort((a, b) => (a.guestName ?? '').localeCompare(b.guestName ?? ''));

    return {
      weddingId: w.id,
      title: w.title,
      coupleNames: w.couple_names ?? null,
      startDate: w.start_date ?? null,
      endDate: w.end_date ?? null,
      totalGuests: wGuests.length,
      totalInvitations: wIgs.length,
      totalResponded,
      events,
      guests: guestRows,
      specialDiets,
    };
  });
}
