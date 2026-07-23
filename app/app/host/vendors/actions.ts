'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Vendor board mutations. vendor + engagement are owner-writable under RLS (like host_group), so these are
// plain inserts/updates/deletes under the signed-in owner's session — no service role, no RPC. RLS enforces
// that every row belongs to a wedding the caller owns; the column types + CHECKs enforce state/currency.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}
function num(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function done(): never {
  revalidatePath('/host/vendors');
  revalidatePath('/schedule');
  redirect('/host/vendors?ok=1');
}
function fail(code: string): never {
  redirect(`/host/vendors?err=${encodeURIComponent(code)}`);
}

export async function addVendor(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const name = s(fd, 'name');
  if (!weddingId || !name) fail('vendor');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('vendor').insert({
      wedding_id: weddingId,
      name,
      category: s(fd, 'category') || 'other',
      contact_name: s(fd, 'contact') || null,
      email: s(fd, 'email') || null,
      phone: s(fd, 'phone') || null,
      host_group_id: s(fd, 'hostGroup') || null,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam vendors] addVendor', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function saveEngagement(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const id = s(fd, 'engagementId');
  const vendorId = s(fd, 'vendorId');
  if (!weddingId || !vendorId) fail('engagement');

  const currency = s(fd, 'currency').toUpperCase();
  const row = {
    wedding_id: weddingId,
    vendor_id: vendorId,
    event_instance_id: s(fd, 'eventInstance') || null,
    state: s(fd, 'state') || 'shortlisted',
    role_title: s(fd, 'role') || null,
    blurb: s(fd, 'blurb') || null,
    quote_amount: num(s(fd, 'amount')),
    quote_currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    notes: s(fd, 'notes') || null,
    updated_at: new Date().toISOString(),
  };

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = id
      ? await app.from('engagement').update(row).eq('id', id).eq('wedding_id', weddingId)
      : await app.from('engagement').insert(row);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam vendors] saveEngagement', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function deleteVendor(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const id = s(fd, 'vendorId');
  if (!weddingId || !id) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('vendor').delete().eq('id', id).eq('wedding_id', weddingId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam vendors] deleteVendor', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function deleteEngagement(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const id = s(fd, 'engagementId');
  if (!weddingId || !id) fail('save');
  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('engagement').delete().eq('id', id).eq('wedding_id', weddingId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam vendors] deleteEngagement', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
