import { redirect } from 'next/navigation';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getCostControl } from '@/lib/data/cost-control';

export default async function RetiredCostsPage(){
  await requireVerifiedUser('/host/costs');
  const access=await getCostControl(await pageClient());
  redirect(access.length?'/host/cost-control':'/host');
}
