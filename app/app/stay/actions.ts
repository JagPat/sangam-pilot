'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Guest self-service for their own stay & travel. Runs under the guest's session; RLS (0018) only lets them
// touch their own household's stay_request and their own travel_detail.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}
function done(): never {
  revalidatePath('/stay');
  redirect('/stay?ok=1');
}
function fail(code: string): never {
  redirect(`/stay?err=${encodeURIComponent(code)}`);
}

export async function setStayRequest(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const householdId = s(fd, 'householdId');
  const status = s(fd, 'status');
  const nights = s(fd, 'nights');
  const arriveOn = s(fd, 'arriveOn') || null;
  const departOn = s(fd, 'departOn') || null;
  const notes = s(fd, 'notes');
  if (!weddingId || !householdId || !status) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('stay_request').upsert(
      {
        wedding_id: weddingId,
        household_id: householdId,
        status,
        nights: nights ? Number(nights) : null,
        arrive_on: arriveOn,
        depart_on: departOn,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wedding_id,household_id' },
    );
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] setStayRequest', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function saveTravel(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  const direction = s(fd, 'direction');
  const mode = s(fd, 'mode') || null;
  const atLocal = s(fd, 'atInstant');
  const carrier = s(fd, 'carrier');
  const number = s(fd, 'number');
  const fromPlace = s(fd, 'fromPlace');
  const arrangedBy = s(fd, 'arrangedBy') || 'self';
  const needsPickup = !!fd.get('needsPickup');
  const luggageNote = s(fd, 'luggageNote');
  if (!weddingId || !guestId || (direction !== 'arrival' && direction !== 'departure')) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('travel_detail').upsert(
      {
        wedding_id: weddingId,
        guest_id: guestId,
        direction,
        mode,
        at_instant: atLocal ? new Date(atLocal).toISOString() : null,
        carrier: carrier || null,
        number: number || null,
        from_place: fromPlace || null,
        arranged_by: arrangedBy,
        needs_pickup: needsPickup,
        luggage_note: luggageNote || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wedding_id,guest_id,direction' },
    );
    if (error) throw error;
  } catch (e) {
    console.error('[sangam stay] saveTravel', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
