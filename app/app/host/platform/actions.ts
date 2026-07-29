'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

export async function setWeddingCreatorAccess(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  if (!email || !email.includes('@')) redirect('/host/platform?err=email');

  const { error } = await (await serverClientRW()).schema('app').rpc('super_admin_set_wedding_creator', {
    p_email: email,
    p_enabled: enabled,
  });
  if (error) redirect('/host/platform?err=save');

  revalidatePath('/host/platform');
  redirect('/host/platform?ok=1');
}
