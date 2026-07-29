import { redirect } from 'next/navigation';
import { requireVerifiedUser } from '@/lib/auth/session';

export default async function RetiredFamilyBudgetPage(){
  await requireVerifiedUser('/host/budget');
  redirect('/host');
}
