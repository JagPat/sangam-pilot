'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Wedding-shell setup. Creating a wedding bootstraps the caller as its owner (create_wedding RPC — the only
// place a not-yet-owner can write). Venues are plain owner_write RLS inserts. Events go through the
// owner_create_event / owner_update_event RPCs, which own the zoned_time composite + offset math, the
// is_wedding_owner check, the enrichment columns, and the hosting-family (event_host_group) set. Everything
// runs as the signed-in user; no service role.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}
function groupIds(fd: FormData): string[] {
  return fd.getAll('hg').map((v) => String(v)).filter(Boolean);
}

function done(): never {
  revalidatePath('/host/setup');
  revalidatePath('/host');
  revalidatePath('/schedule');
  redirect('/host/setup?ok=1');
}

function fail(code: string): never {
  redirect(`/host/setup?err=${encodeURIComponent(code)}`);
}

export async function createWedding(fd: FormData): Promise<void> {
  const title = s(fd, 'title');
  const couple = s(fd, 'couple');
  const tz = s(fd, 'tz');
  const start = s(fd, 'start');
  const end = s(fd, 'end');
  if (!title) fail('title');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('create_wedding', {
      p_title: title, p_couple: couple || null, p_tz: tz || null, p_start: start || null, p_end: end || null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam setup] createWedding', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function addVenue(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const name = s(fd, 'name');
  const tz = s(fd, 'tz');
  const address = s(fd, 'address');
  const mapUrl = s(fd, 'mapUrl');
  if (!weddingId || !name) fail('venue');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('venue').insert({
      wedding_id: weddingId, name, iana_timezone: tz || 'Asia/Kolkata', address: address || null, map_url: mapUrl || null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam setup] addVenue', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function addEvent(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
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
  const hg = groupIds(fd);
  if (!weddingId || !name || !wall) fail('event');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_create_event', {
      p_wedding: weddingId, p_name: name, p_type: type || null, p_venue: venue || null, p_wall: wall, p_tz: tz || null,
      p_dress: dress || null, p_muhurat_wall: muhurat || null, p_tithi: tithi || null,
      p_choghadiya: chogh || null, p_stream: stream || null, p_host_groups: hg.length ? hg : null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam setup] addEvent', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// Handles both Save and Cancel/Restore: the clicked button sets `cancelled` (true/false), and the form
// carries the full current field set (incl. enrichment + hosting families), so the RPC never wipes a field
// it wasn't meant to. An empty family selection clears the assignments.
export async function updateEvent(fd: FormData): Promise<void> {
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
  const hg = groupIds(fd);
  if (!weddingId || !instanceId) fail('event');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_update_event', {
      p_wedding: weddingId, p_instance: instanceId, p_name: name || null, p_type: type || null,
      p_venue: venue || null, p_wall: wall || null, p_tz: tz || null, p_cancelled: cancelled,
      p_dress: dress || null, p_muhurat_wall: muhurat || null, p_tithi: tithi || null,
      p_choghadiya: chogh || null, p_stream: stream || null, p_host_groups: hg,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam setup] updateEvent', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
