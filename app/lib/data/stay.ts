import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the Stay & Travel console (/host/stay), layer 1: room inventory + the rooming list +
// occupancy. Owner-scoped (the RLS in 0017 is owner-only for now). READ ONLY; writes go through the server
// actions in app/host/stay/actions.ts.

export const ROOM_TYPES = [
  { value: 'single', label: 'Single', capacity: 1 },
  { value: 'double', label: 'Double', capacity: 2 },
  { value: 'triple', label: 'Triple', capacity: 3 },
  { value: 'quad', label: 'Quad', capacity: 4 },
  { value: 'suite', label: 'Suite', capacity: 4 },
] as const;

export type StayOccupant = { guestId: string; guestName: string | null };
export type StayAllocation = {
  allocationId: string; householdId: string; householdName: string | null;
  status: string; checkIn: string | null; checkOut: string | null; occupants: StayOccupant[];
};
export type StayRoom = {
  roomId: string; label: string; roomType: string; capacity: number;
  hotelId: string; hotelName: string; outOfService: boolean; allocation: StayAllocation | null;
};
export type StayHotel = { id: string; name: string };
export type StaySummary = { roomType: string; total: number; occupied: number; free: number };
export type StayHousehold = { id: string; name: string; allocated: boolean; guests: StayOccupant[] };
export type StayWedding = {
  weddingId: string; title: string;
  hotels: StayHotel[]; rooms: StayRoom[]; summary: StaySummary[]; households: StayHousehold[];
  totals: { rooms: number; occupied: number; free: number };
};

export async function getStayData(db: AppSupabaseClient): Promise<StayWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, hotels, rooms, allocs, occ, households, guests, summary] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('hotel').select('id, wedding_id, name').in('wedding_id', weddingIds),
    app.from('room').select('id, wedding_id, hotel_id, label, room_type, capacity, out_of_service').in('wedding_id', weddingIds),
    app.from('room_allocation').select('id, wedding_id, room_id, household_id, status, check_in, check_out').in('wedding_id', weddingIds).neq('status', 'cancelled'),
    app.from('room_occupant').select('wedding_id, allocation_id, guest_id').in('wedding_id', weddingIds),
    app.from('household').select('id, wedding_id, name').in('wedding_id', weddingIds),
    app.from('guest').select('id, wedding_id, household_id, full_name').in('wedding_id', weddingIds),
    app.from('stay_summary').select('wedding_id, room_type, total_rooms, occupied_rooms, free_rooms').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, hotels, rooms, allocs, occ, households, guests, summary]) if (r.error) throw r.error;

  const guestName = new Map((guests.data ?? []).map((g) => [g.id, g.full_name ?? null]));
  const hhName = new Map((households.data ?? []).map((h) => [h.id, h.name]));

  return (weds.data ?? []).map((w) => {
    const wHotels = (hotels.data ?? []).filter((h) => h.wedding_id === w.id);
    const hotelName = new Map(wHotels.map((h) => [h.id, h.name]));

    const wAllocs = (allocs.data ?? []).filter((a) => a.wedding_id === w.id);
    const occByAlloc = new Map<string, StayOccupant[]>();
    for (const o of (occ.data ?? []).filter((x) => x.wedding_id === w.id)) {
      const arr = occByAlloc.get(o.allocation_id) ?? [];
      arr.push({ guestId: o.guest_id, guestName: guestName.get(o.guest_id) ?? null });
      occByAlloc.set(o.allocation_id, arr);
    }
    const allocByRoom = new Map<string, StayAllocation>();
    for (const a of wAllocs) {
      allocByRoom.set(a.room_id, {
        allocationId: a.id, householdId: a.household_id, householdName: hhName.get(a.household_id) ?? null,
        status: a.status, checkIn: a.check_in ?? null, checkOut: a.check_out ?? null,
        occupants: (occByAlloc.get(a.id) ?? []).sort((x, y) => (x.guestName ?? '').localeCompare(y.guestName ?? '')),
      });
    }

    const roomsOut: StayRoom[] = (rooms.data ?? [])
      .filter((r) => r.wedding_id === w.id)
      .map((r) => ({
        roomId: r.id, label: r.label, roomType: r.room_type, capacity: r.capacity, hotelId: r.hotel_id,
        hotelName: hotelName.get(r.hotel_id) ?? '—', outOfService: r.out_of_service,
        allocation: allocByRoom.get(r.id) ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

    const allocated = new Set(wAllocs.map((a) => a.household_id));
    const wHouseholds: StayHousehold[] = (households.data ?? [])
      .filter((h) => h.wedding_id === w.id)
      .map((h) => ({
        id: h.id, name: h.name, allocated: allocated.has(h.id),
        guests: (guests.data ?? []).filter((g) => g.household_id === h.id).map((g) => ({ guestId: g.id, guestName: g.full_name ?? null })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const summ: StaySummary[] = (summary.data ?? [])
      .filter((s) => s.wedding_id === w.id)
      .map((s) => ({ roomType: s.room_type, total: Number(s.total_rooms), occupied: Number(s.occupied_rooms), free: Number(s.free_rooms) }))
      .sort((a, b) => a.roomType.localeCompare(b.roomType));
    const totals = summ.reduce((acc, s) => ({ rooms: acc.rooms + s.total, occupied: acc.occupied + s.occupied, free: acc.free + s.free }), { rooms: 0, occupied: 0, free: 0 });

    return { weddingId: w.id, title: w.title, hotels: wHotels.map((h) => ({ id: h.id, name: h.name })), rooms: roomsOut, summary: summ, households: wHouseholds, totals };
  });
}
