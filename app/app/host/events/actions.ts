'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Family-admin event writes. Everything runs under the signed-in admin's session; the group_* RPCs (0021)
// own the zoned_time math and enforce that the caller may only create for a side they admin and only edit an
// event their side hosts. The host group is stamped server-side from the form's hidden hostGroupId (which the
// RPC re-checks), so a family admin can never create for the other side.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}
function done(): never {
  revalidatePath('/host/events');
  revalidatePath('/schedule');
  redirect('/host/events?ok=1');
}
function fail(code: string): never {
  redirect(`/host/events?err=${encodeURIComponent(code)}`);
}

export async function createSideEvent(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const hostGroupId = s(fd, 'hostGroupId');
  const name = s(fd, 'name');
  const type = s(fd, 'type');
  const venue = s(fd, 'venue');
  const wall = s(fd, 'wall');
  const tz = s(fd, 'tz');
  const dress = s(fd, 'dress');
  const muhurat = s(fd, 'muhurat');
  const tithi = s(fd, 'tithi');
  const chogh = s(fd, 'choghadiya');
  const stream = s(fd, 'stream');
  if (!weddingId || !hostGroupId || !name || !wall) fail('event');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('group_create_event', {
      p_wedding: weddingId, p_host_group: hostGroupId, p_name: name, p_type: type || null, p_venue: venue || null,
      p_wall: wall, p_tz: tz || null, p_dress: dress || null, p_muhurat_wall: muhurat || null,
      p_tithi: tithi || null, p_choghadiya: chogh || null, p_stream: stream || null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam events] createSideEvent', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Handles Save and Cancel/Restore: the clicked button sets `cancelled`, and the form carries the full field
// set so the RPC never wipes a field it wasn't handed.
export async function updateSideEvent(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const instanceId = s(fd, 'instanceId');
  const name = s(fd, 'name');
  const type = s(fd, 'type');
  const venue = s(fd, 'venue');
  const wall = s(fd, 'wall');
  const tz = s(fd, 'tz');
  const cancelled = s(fd, 'cancelled') === 'true';
  const dress = s(fd, 'dress');
  const muhurat = s(fd, 'muhurat');
  const tithi = s(fd, 'tithi');
  const chogh = s(fd, 'choghadiya');
  const stream = s(fd, 'stream');
  if (!weddingId || !instanceId) fail('event');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('group_update_event', {
      p_wedding: weddingId, p_instance: instanceId, p_name: name || null, p_type: type || null,
      p_venue: venue || null, p_wall: wall || null, p_tz: tz || null, p_cancelled: cancelled,
      p_dress: dress || null, p_muhurat_wall: muhurat || null, p_tithi: tithi || null,
      p_choghadiya: chogh || null, p_stream: stream || null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam events] updateSideEvent', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
