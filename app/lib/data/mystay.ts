import type { AppSupabaseClient } from '../supabase/clients';

// The signed-in guest's own stay & travel (for /stay). Everything runs under the guest's session: RLS on
// stay_request / travel_detail returns only their own household/records, and app.my_stay() (definer) returns
// only their own room. A household head acting as proxy sees each member they can act for.

export const TRAVEL_MODES = [
  { value: 'flight', label: 'Flight' },
  { value: 'train', label: 'Train' },
  { value: 'car', label: 'Car' },
  { value: 'bus', label: 'Bus' },
  { value: 'self', label: 'Self / other' },
] as const;

export type MyTravel = {
  mode: string | null; atInstant: string | null; carrier: string | null; number: string | null;
  fromPlace: string | null; arrangedBy: string; needsPickup: boolean; pickupStatus: string; luggageNote: string | null;
};
export type MyStayGuest = { guestId: string; guestName: string | null; arrival: MyTravel | null; departure: MyTravel | null };
export type MyStayHousehold = {
  weddingId: string; householdId: string; householdName: string | null;
  request: { status: string; nights: number | null; arriveOn: string | null; departOn: string | null; notes: string | null } | null;
  guests: MyStayGuest[];
};
export type MyStayRoom = { roomLabel: string; roomType: string; hotelName: string; checkIn: string | null; checkOut: string | null; status: string; roommates: string[] };
export type MyStayData = { households: MyStayHousehold[]; rooms: MyStayRoom[] };

type TravelRow = {
  guest_id: string; direction: string; mode: string | null; at_instant: string | null; carrier: string | null;
  number: string | null; from_place: string | null; arranged_by: string; needs_pickup: boolean; pickup_status: string; luggage_note: string | null;
};

function toTravel(t: TravelRow | undefined): MyTravel | null {
  if (!t) return null;
  return { mode: t.mode ?? null, atInstant: t.at_instant ?? null, carrier: t.carrier ?? null, number: t.number ?? null, fromPlace: t.from_place ?? null, arrangedBy: t.arranged_by, needsPickup: t.needs_pickup, pickupStatus: t.pickup_status, luggageNote: t.luggage_note ?? null };
}

export async function getMyStay(db: AppSupabaseClient): Promise<MyStayData> {
  const app = db.schema('app');
  const [guests, roomsRes] = await Promise.all([
    app.from('guest').select('id, wedding_id, household_id, full_name'), // RLS → only guests I can act for
    app.rpc('my_stay'),
  ]);
  if (guests.error) throw guests.error;
  if (roomsRes.error) throw roomsRes.error;
  const gs = guests.data ?? [];
  if (gs.length === 0) return { households: [], rooms: [] };

  const householdIds = [...new Set(gs.map((g) => g.household_id))];
  const guestIds = gs.map((g) => g.id);
  const [households, requests, travel] = await Promise.all([
    app.from('household').select('id, name').in('id', householdIds),
    app.from('stay_request').select('household_id, status, nights, arrive_on, depart_on, notes').in('household_id', householdIds),
    app.from('travel_detail').select('guest_id, direction, mode, at_instant, carrier, number, from_place, arranged_by, needs_pickup, pickup_status, luggage_note').in('guest_id', guestIds),
  ]);
  if (households.error) throw households.error;
  if (requests.error) throw requests.error;
  if (travel.error) throw travel.error;

  const hhName = new Map((households.data ?? []).map((h) => [h.id, h.name]));
  const reqByHh = new Map((requests.data ?? []).map((r) => [r.household_id, r]));
  const travByKey = new Map<string, TravelRow>();
  for (const t of (travel.data ?? []) as TravelRow[]) travByKey.set(`${t.guest_id}:${t.direction}`, t);

  const byHh = new Map<string, MyStayHousehold>();
  for (const g of gs) {
    let hh = byHh.get(g.household_id);
    if (!hh) {
      const r = reqByHh.get(g.household_id);
      hh = {
        weddingId: g.wedding_id, householdId: g.household_id, householdName: hhName.get(g.household_id) ?? null,
        request: r ? { status: r.status, nights: r.nights ?? null, arriveOn: r.arrive_on ?? null, departOn: r.depart_on ?? null, notes: r.notes ?? null } : null,
        guests: [],
      };
      byHh.set(g.household_id, hh);
    }
    hh.guests.push({
      guestId: g.id, guestName: g.full_name ?? null,
      arrival: toTravel(travByKey.get(`${g.id}:arrival`)),
      departure: toTravel(travByKey.get(`${g.id}:departure`)),
    });
  }

  const rooms: MyStayRoom[] = (roomsRes.data ?? []).map((r) => ({
    roomLabel: r.room_label, roomType: r.room_type, hotelName: r.hotel_name,
    checkIn: r.check_in ?? null, checkOut: r.check_out ?? null, status: r.status,
    roommates: (r.roommates ?? []).filter(Boolean),
  }));

  return { households: [...byHh.values()], rooms };
}
