import type { AppSupabaseClient } from '../supabase/clients';
import { chargeableUnits, formatMoney } from './services';

// Read-only Stay & Travel oversight for a family admin (their own side), plus the activity log — Stay layer 4.
// Everything runs under the admin's session; the 0016 + 0020 policies already limit every table to their
// side (households/guests they administer) and the log to their side + wedding-level entries. No writes here.

export type FamilyTravel = { mode: string | null; atInstant: string | null; carrier: string | null; number: string | null; fromPlace: string | null; needsPickup: boolean; pickupStatus: string };
export type FamilyGuest = { guestId: string; guestName: string | null; arrival: FamilyTravel | null; departure: FamilyTravel | null };
export type FamilyRoom = { label: string; roomType: string; hotelName: string; status: string; occupants: string[] };
export type FamilyService = { name: string; billing: string; who: string | null; qty: number; status: string; settle: string; chargeLabel: string | null };
export type FamilyHousehold = {
  householdId: string; householdName: string | null;
  rooms: FamilyRoom[];
  request: { status: string; nights: number | null; arriveOn: string | null; departOn: string | null; notes: string | null } | null;
  guests: FamilyGuest[];
  services: FamilyService[];
};
export type ActivityEntry = { action: string; summary: string; when: string; who: string | null };
export type FamilyStayOverview = { weddingId: string; title: string; households: FamilyHousehold[]; activity: ActivityEntry[] };

type TravelRow = { guest_id: string; direction: string; mode: string | null; at_instant: string | null; carrier: string | null; number: string | null; from_place: string | null; needs_pickup: boolean; pickup_status: string };

function toTravel(t: TravelRow | undefined): FamilyTravel | null {
  if (!t) return null;
  return { mode: t.mode ?? null, atInstant: t.at_instant ?? null, carrier: t.carrier ?? null, number: t.number ?? null, fromPlace: t.from_place ?? null, needsPickup: t.needs_pickup, pickupStatus: t.pickup_status };
}

export async function getFamilyStayOverview(db: AppSupabaseClient): Promise<FamilyStayOverview[]> {
  const app = db.schema('app');
  const households = await app.from('household').select('id, wedding_id, name'); // RLS → this admin's side only
  if (households.error) throw households.error;
  const hhs = households.data ?? [];
  if (hhs.length === 0) return [];

  const weddingIds = [...new Set(hhs.map((h) => h.wedding_id))];
  const householdIds = hhs.map((h) => h.id);

  const [weds, guests, allocs, occ, rooms, hotels, requests, travel, services, sreqs, activity] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('guest').select('id, wedding_id, household_id, full_name').in('household_id', householdIds),
    app.from('room_allocation').select('id, wedding_id, room_id, household_id, status').in('household_id', householdIds).neq('status', 'cancelled'),
    app.from('room_occupant').select('allocation_id, guest_id').in('wedding_id', weddingIds),
    app.from('room').select('id, hotel_id, label, room_type').in('wedding_id', weddingIds),
    app.from('hotel').select('id, name').in('wedding_id', weddingIds),
    app.from('stay_request').select('household_id, status, nights, arrive_on, depart_on, notes').in('household_id', householdIds),
    app.from('travel_detail').select('guest_id, direction, mode, at_instant, carrier, number, from_place, needs_pickup, pickup_status').in('wedding_id', weddingIds),
    app.from('service').select('id, name, billing, price_cents, currency, included_qty').in('wedding_id', weddingIds),
    app.from('service_request').select('service_id, household_id, guest_id, qty, status, settle').in('household_id', householdIds),
    app.from('stay_activity').select('wedding_id, action, summary, created_at, household_id, guest_id').in('wedding_id', weddingIds).order('created_at', { ascending: false }).limit(60),
  ]);
  for (const r of [weds, guests, allocs, occ, rooms, hotels, requests, travel, services, sreqs, activity]) if (r.error) throw r.error;

  const guestName = new Map((guests.data ?? []).map((g) => [g.id, g.full_name ?? null]));
  const hhName = new Map(hhs.map((h) => [h.id, h.name]));
  const roomById = new Map((rooms.data ?? []).map((r) => [r.id, r]));
  const hotelName = new Map((hotels.data ?? []).map((h) => [h.id, h.name]));
  const svcById = new Map((services.data ?? []).map((s) => [s.id, s]));

  const occByAlloc = new Map<string, string[]>();
  for (const o of occ.data ?? []) {
    const arr = occByAlloc.get(o.allocation_id) ?? [];
    const nm = guestName.get(o.guest_id);
    if (nm) arr.push(nm);
    occByAlloc.set(o.allocation_id, arr);
  }
  const reqByHh = new Map((requests.data ?? []).map((r) => [r.household_id, r]));
  const travByKey = new Map<string, TravelRow>();
  for (const t of (travel.data ?? []) as TravelRow[]) travByKey.set(`${t.guest_id}:${t.direction}`, t);

  return (weds.data ?? []).map((w) => {
    const wHhs = hhs.filter((h) => h.wedding_id === w.id);
    const households: FamilyHousehold[] = wHhs.map((h) => {
      const hhAllocs = (allocs.data ?? []).filter((a) => a.household_id === h.id);
      const familyRooms: FamilyRoom[] = hhAllocs.map((a) => {
        const rm = roomById.get(a.room_id);
        return { label: rm?.label ?? '—', roomType: rm?.room_type ?? '', hotelName: rm ? (hotelName.get(rm.hotel_id) ?? '—') : '—', status: a.status, occupants: (occByAlloc.get(a.id) ?? []).sort() };
      });
      const r = reqByHh.get(h.id);
      const hhGuests: FamilyGuest[] = (guests.data ?? []).filter((g) => g.household_id === h.id).map((g) => ({
        guestId: g.id, guestName: g.full_name ?? null,
        arrival: toTravel(travByKey.get(`${g.id}:arrival`)), departure: toTravel(travByKey.get(`${g.id}:departure`)),
      }));
      const hhServices: FamilyService[] = (sreqs.data ?? []).filter((s) => s.household_id === h.id && s.status !== 'cancelled').map((s) => {
        const svc = svcById.get(s.service_id);
        const charge = svc ? chargeableUnits(svc.billing, s.qty, svc.included_qty) * svc.price_cents : 0;
        return {
          name: svc?.name ?? '—', billing: svc?.billing ?? 'guest_paid',
          who: s.guest_id ? (guestName.get(s.guest_id) ?? null) : null, qty: s.qty, status: s.status, settle: s.settle,
          chargeLabel: charge > 0 ? formatMoney(charge, svc?.currency ?? 'INR') : null,
        };
      });
      return {
        householdId: h.id, householdName: h.name, rooms: familyRooms,
        request: r ? { status: r.status, nights: r.nights ?? null, arriveOn: r.arrive_on ?? null, departOn: r.depart_on ?? null, notes: r.notes ?? null } : null,
        guests: hhGuests, services: hhServices,
      };
    });

    const wActivity: ActivityEntry[] = (activity.data ?? []).filter((a) => a.wedding_id === w.id).map((a) => ({
      action: a.action, summary: a.summary, when: a.created_at,
      who: a.household_id ? (hhName.get(a.household_id) ?? null) : a.guest_id ? (guestName.get(a.guest_id) ?? null) : null,
    }));

    return { weddingId: w.id, title: w.title, households, activity: wActivity };
  });
}
