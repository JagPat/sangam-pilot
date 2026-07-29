'use server';

import { redirect } from 'next/navigation';
import { requireVerifiedUser } from '@/lib/auth/session';
import { linkSignedInAccount } from '@/lib/auth/link';
import { serverClientRW } from '@/lib/supabase/serverClient';
import type { AppSupabaseClient } from '@/lib/supabase/clients';
import { getOrganizerNav } from '@/lib/data/nav';
import { getCreatorAccess } from '@/lib/data/creator-access';
import { postAuthDestination, safeInternalPath, withSafeNext } from '@/lib/auth/landing';

export async function retryAccountSetup(formData: FormData): Promise<void> {
  const requestedNext = String(formData.get('next') ?? '');
  const next = requestedNext ? safeInternalPath(requestedNext, '/schedule') : null;
  const user = await requireVerifiedUser(next ? withSafeNext('/access', next) : '/access');
  const result = await linkSignedInAccount(user.id);
  if (!result.ok) redirect(withSafeNext('/access?reason=account_link_failed', next));

  const db = (await serverClientRW()) as unknown as AppSupabaseClient;
  const [nav, creator] = await Promise.all([getOrganizerNav(db), getCreatorAccess(db)]);
  redirect(postAuthDestination(next, nav.sections, creator.canCreateWedding));
}
