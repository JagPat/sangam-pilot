'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Stay & Travel writes (layer 1). Owner session; the 0017 owner-only RLS is the guard. The DB trigger
// enforces room capacity and no double-booking, surfaced here as friendly messages.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}
function errCode(e: unknown): string | undefined {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code) : undefined;
}
function done(): never {
  revalidatePath('/host/stay');
  revalidatePath('/host');
  redirect('/host/stay?ok=1');
}
function fail(code: string): never {
  redirect(`/host/stay?err=${encodeURIComponent(code)}`);
}

export async function addHotel(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const name = s(fd, 'name');
  const address = s(fd, 'address');
  if (!weddingId || !name) fail('name');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('hotel').insert({ wedding_id: weddingId, name, address: address || null });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] addHotel', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Bulk-add rooms of one type. Labels: a numeric start counts up (201, 202…); otherwise a prefix + index.
export async function addRooms(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const hotelId = s(fd, 'hotelId');
  const roomType = s(fd, 'roomType');
  const capacity = parseInt(s(fd, 'capacity'), 10);
  const count = parseInt(s(fd, 'count'), 10);
  const startLabel = s(fd, 'startLabel');
  if (!weddingId || !hotelId || !roomType) fail('rooms');
  const cap = Number.isFinite(capacity) && capacity > 0 ? capacity : 2;
  const n = Number.isFinite(count) && count > 0 ? Math.min(count, 500) : 1;
  const startNum = parseInt(startLabel, 10);
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const rows = Array.from({ length: n }, (_, i) => ({
      wedding_id: weddingId,
      hotel_id: hotelId,
      room_type: roomType,
      capacity: cap,
      label: Number.isFinite(startNum) ? String(startNum + i) : startLabel ? `${startLabel}-${i + 1}` : `${i + 1}`,
    }));
    const { error } = await app.from('room').insert(rows);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] addRooms', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Allocate a household to a room and seat up to the room's capacity of that household's guests.
export async function allocateHousehold(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const roomId = s(fd, 'roomId');
  const householdId = s(fd, 'householdId');
  const checkIn = s(fd, 'checkIn') || null;
  const checkOut = s(fd, 'checkOut') || null;
  if (!weddingId || !roomId || !householdId) fail('alloc');
  let ok = true;
  let code = 'alloc';
  try {
    const app = (await serverClientRW()).schema('app');
    const [roomRes, guestsRes] = await Promise.all([
      app.from('room').select('capacity').eq('wedding_id', weddingId).eq('id', roomId).single(),
      app.from('guest').select('id').eq('wedding_id', weddingId).eq('household_id', householdId),
    ]);
    if (roomRes.error) throw roomRes.error;
    if (guestsRes.error) throw guestsRes.error;

    const { data: alloc, error: ea } = await app
      .from('room_allocation')
      .insert({ wedding_id: weddingId, room_id: roomId, household_id: householdId, check_in: checkIn, check_out: checkOut, status: 'held' })
      .select('id')
      .single();
    if (ea) {
      if (errCode(ea) === '23505') code = 'occupied';
      throw ea;
    }
    const seat = (guestsRes.data ?? []).slice(0, roomRes.data!.capacity).map((g) => ({
      wedding_id: weddingId,
      allocation_id: alloc.id,
      guest_id: g.id,
    }));
    if (seat.length) {
      const { error: eo } = await app.from('room_occupant').insert(seat);
      if (eo) throw eo;
    }
  } catch (e) {
    console.error('[sangam stay] allocateHousehold', e);
    ok = false;
  }
  if (!ok) fail(code);
  done();
}

export async function setAllocationStatus(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const allocationId = s(fd, 'allocationId');
  const status = s(fd, 'status');
  if (!weddingId || !allocationId || !status) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('room_allocation').update({ status }).eq('wedding_id', weddingId).eq('id', allocationId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] setAllocationStatus', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function addOccupant(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const allocationId = s(fd, 'allocationId');
  const guestId = s(fd, 'guestId');
  if (!weddingId || !allocationId || !guestId) fail('save');
  let ok = true;
  let code = 'save';
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('room_occupant').insert({ wedding_id: weddingId, allocation_id: allocationId, guest_id: guestId });
    if (error) {
      const c = errCode(error);
      if (c === 'SA011') code = 'full';
      else if (c === 'SA012') code = 'guestbusy';
      throw error;
    }
  } catch (e) {
    console.error('[sangam stay] addOccupant', e);
    ok = false;
  }
  if (!ok) fail(code);
  done();
}

export async function removeOccupant(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const allocationId = s(fd, 'allocationId');
  const guestId = s(fd, 'guestId');
  if (!weddingId || !allocationId || !guestId) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('room_occupant').delete().eq('wedding_id', weddingId).eq('allocation_id', allocationId).eq('guest_id', guestId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] removeOccupant', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Transport desk: mark a guest's pickup as assigned / done (or back to requested) for one direction.
export async function setPickupStatus(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  const direction = s(fd, 'direction');
  const pickupStatus = s(fd, 'pickupStatus');
  if (!weddingId || !guestId || (direction !== 'arrival' && direction !== 'departure') || !pickupStatus) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app
      .from('travel_detail')
      .update({ pickup_status: pickupStatus })
      .eq('wedding_id', weddingId)
      .eq('guest_id', guestId)
      .eq('direction', direction);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] setPickupStatus', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Waitlist desk: move a household's room ask along (waitlisted / declined / back to needs_room).
export async function setStayRequestStatus(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const householdId = s(fd, 'householdId');
  const status = s(fd, 'status');
  if (!weddingId || !householdId || !status) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app
      .from('stay_request')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('wedding_id', weddingId)
      .eq('household_id', householdId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] setStayRequestStatus', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// ---------- services (layer 3) ----------

// Create or edit a catalogue item. Price is entered in rupees and stored as minor units (paise).
export async function saveService(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const serviceId = s(fd, 'serviceId');
  const name = s(fd, 'name');
  const description = s(fd, 'description');
  const category = s(fd, 'category');
  const billing = s(fd, 'billing') || 'guest_paid';
  const scope = s(fd, 'scope') || 'per_person';
  const settleHint = s(fd, 'settleHint') || 'front_desk';
  const unitLabel = s(fd, 'unitLabel');
  const priceRaw = parseFloat(s(fd, 'price'));
  const priceCents = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw * 100) : 0;
  const incRaw = parseInt(s(fd, 'includedQty'), 10);
  const includedQty = billing === 'allowance' ? (Number.isFinite(incRaw) && incRaw > 0 ? incRaw : null) : null;
  if (!weddingId || !name) fail('name');
  if (billing === 'allowance' && includedQty === null) fail('allowanceqty');
  let ok = true;
  let code = 'save';
  const row = {
    name, description: description || null, category: category || null, billing, scope, settle_hint: settleHint,
    unit_label: unitLabel || null, price_cents: priceCents, included_qty: includedQty,
  };
  try {
    const app = (await serverClientRW()).schema('app');
    if (serviceId) {
      const { error } = await app.from('service').update({ ...row, updated_at: new Date().toISOString() }).eq('wedding_id', weddingId).eq('id', serviceId);
      if (error) throw error;
    } else {
      const { error } = await app.from('service').insert({ wedding_id: weddingId, ...row });
      if (error) throw error;
    }
  } catch (e) {
    if (errCode(e) === '23514') code = 'allowanceqty';
    console.error('[sangam stay] saveService', e);
    ok = false;
  }
  if (!ok) fail(code);
  done();
}

export async function setServiceActive(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const serviceId = s(fd, 'serviceId');
  const active = !!fd.get('active');
  if (!weddingId || !serviceId) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('service').update({ active, updated_at: new Date().toISOString() }).eq('wedding_id', weddingId).eq('id', serviceId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] setServiceActive', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Owner moves a request along (confirm / deliver / decline) and/or records the guest-paid settlement.
export async function setServiceRequestState(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const requestId = s(fd, 'requestId');
  const status = s(fd, 'status');
  const settle = s(fd, 'settle');
  if (!weddingId || !requestId || (!status && !settle)) fail('save');
  const patch: { status?: string; settle?: string; updated_at: string } = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (settle) patch.settle = settle;
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('service_request').update(patch).eq('wedding_id', weddingId).eq('id', requestId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] setServiceRequestState', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function toggleRoomService(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const roomId = s(fd, 'roomId');
  const outOfService = !!fd.get('outOfService');
  if (!weddingId || !roomId) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('room').update({ out_of_service: outOfService }).eq('wedding_id', weddingId).eq('id', roomId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] toggleRoomService', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
