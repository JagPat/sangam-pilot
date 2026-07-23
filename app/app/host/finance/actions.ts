'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Owner-only finance writes. Every call goes through the SECURITY DEFINER RPCs (owner_add/update/delete_
// expense), which check is_wedding_owner, convert percentages to authoritative amounts, and rely on the
// deferred balance trigger to guarantee allocations sum to the expense amount. No direct table DML.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}

function done(): never {
  revalidatePath('/host/finance');
  redirect('/host/finance?ok=1');
}
function fail(code: string): never {
  redirect(`/host/finance?err=${encodeURIComponent(code)}`);
}

// Collect per-group allocation inputs (name="alloc_<hostGroupId>") into the RPC's jsonb shape. `basis`
// decides whether the values are percentages or fixed amounts (never mixed).
function buildAllocations(fd: FormData): Record<string, unknown>[] {
  const basis = s(fd, 'basis') === 'amount' ? 'amount' : 'percent';
  const out: Record<string, unknown>[] = [];
  for (const [key, val] of fd.entries()) {
    if (!key.startsWith('alloc_')) continue;
    const v = Number(String(val).trim());
    if (!Number.isFinite(v) || v <= 0) continue;
    out.push({ group: key.slice('alloc_'.length), [basis]: v });
  }
  return out;
}

export async function addExpense(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const description = s(fd, 'description');
  const amount = Number(s(fd, 'amount'));
  const currency = s(fd, 'currency') || 'INR';
  const paidAt = s(fd, 'paidAt');
  const paidBy = s(fd, 'paidBy');
  const category = s(fd, 'category');
  const note = s(fd, 'note');
  if (!weddingId || !description || !Number.isFinite(amount) || amount <= 0 || !paidAt || !paidBy) fail('fields');
  const allocations = buildAllocations(fd);
  if (allocations.length === 0) fail('alloc');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_add_expense', {
      p_wedding: weddingId, p_description: description, p_category: category || null, p_amount: amount,
      p_currency: currency, p_paid_at: paidAt, p_paid_by_host_group: paidBy, p_note: note || null,
      p_allocations: allocations as never,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam finance] addExpense', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function updateExpense(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const expenseId = s(fd, 'expenseId');
  const description = s(fd, 'description');
  const amount = Number(s(fd, 'amount'));
  const currency = s(fd, 'currency') || 'INR';
  const paidAt = s(fd, 'paidAt');
  const paidBy = s(fd, 'paidBy');
  const category = s(fd, 'category');
  const note = s(fd, 'note');
  if (!weddingId || !expenseId || !description || !Number.isFinite(amount) || amount <= 0 || !paidAt || !paidBy) fail('fields');
  const allocations = buildAllocations(fd);
  if (allocations.length === 0) fail('alloc');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_update_expense', {
      p_wedding: weddingId, p_expense: expenseId, p_description: description, p_category: category || null, p_amount: amount,
      p_currency: currency, p_paid_at: paidAt, p_paid_by_host_group: paidBy, p_note: note || null,
      p_allocations: allocations as never,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam finance] updateExpense', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function deleteExpense(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const expenseId = s(fd, 'expenseId');
  if (!weddingId || !expenseId) fail('save');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_delete_expense', { p_wedding: weddingId, p_expense: expenseId });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam finance] deleteExpense', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
