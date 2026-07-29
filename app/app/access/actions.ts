'use server';

import { redirect } from 'next/navigation';
import { requireVerifiedUser } from '@/lib/auth/session';
import { linkSignedInAccount } from '@/lib/auth/link';
import { serverClientRW } from '@/lib/supabase/serverClient';
import type { AppSupabaseClient } from '@/lib/supabase/clients';
import { getOrganizerNav } from '@/lib/data/nav';
import { getCreatorAccess } from '@/lib/data/creator-access';
import { postAuthDestination } from '@/lib/auth/landing';

export async function retryAccountSetup(): Promise<void> {
  const user = await requireVerifiedUser('/access');
  const result = await linkSignedInAccount(user.id);
  if (!result.ok) redirect('/access?reason=account_link_failed');

  const db = (await serverClientRW()) as unknown as AppSupabaseClient;
  const [nav, creator] = await Promise.all([getOrganizerNav(db), getCreatorAccess(db)]);
  redirect(postAuthDestination(null, nav.sections, creator.canCreateWedding));
}
