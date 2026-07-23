'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Family (host_group) + family-admin management. Everything is owner-checked inside the RPCs (0012); the
// only privileged step — minting an app.account for an admin's email — happens inside owner_assign_group_admin
// (SECURITY DEFINER), never here. Runs as the signed-in user; no service role.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}

function done(): never {
  revalidatePath('/host/groups');
  revalidatePath('/host');
  revalidatePath('/host/finance');
  redirect('/host/groups?ok=1');
}

function fail(code: string): never {
  redirect(`/host/groups?err=${encodeURIComponent(code)}`);
}

export async function createGroup(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const kind = s(fd, 'kind');
  const name = s(fd, 'name');
  if (!weddingId || !kind || !name) fail('group');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_create_host_group', { p_wedding: weddingId, p_kind: kind, p_name: name });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam groups] createGroup', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function renameGroup(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const group = s(fd, 'group');
  const name = s(fd, 'name');
  if (!weddingId || !group || !name) fail('group');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_rename_host_group', { p_wedding: weddingId, p_group: group, p_name: name });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam groups] renameGroup', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

export async function deleteGroup(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const group = s(fd, 'group');
  if (!weddingId || !group) fail('group');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_delete_host_group', { p_wedding: weddingId, p_group: group });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam groups] deleteGroup', e);
    ok = false;
  }
  if (!ok) fail('inuse'); // the guard raises when admins/households/expenses are still attached
  done();
}

export async function assignAdmin(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const group = s(fd, 'group');
  const email = s(fd, 'email');
  const role = s(fd, 'role') || 'host_group_admin';
  if (!weddingId || !group || !email) fail('admin');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_assign_group_admin', {
      p_wedding: weddingId, p_host_group: group, p_email: email, p_role: role,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam groups] assignAdmin', e);
    ok = false;
  }
  if (!ok) fail('admin');
  done();
}

export async function removeOperator(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const operatorRole = s(fd, 'operatorRole');
  if (!weddingId || !operatorRole) fail('save');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.rpc('owner_remove_operator_role', { p_wedding: weddingId, p_operator_role: operatorRole });
    if (error) throw error;
  } catch (e) {
    console.error('[sangam groups] removeOperator', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}
