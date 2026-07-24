import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getFamilyBudget, type FamilyBudgetWedding } from '@/lib/data/family-finance';
import { FamilyBudgetWeddingView } from './FamilyBudgetView';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic';

export default async function BudgetPage() {
  await requireVerifiedUser('/host/budget');

  const db = await pageClient();
  let weddings: FamilyBudgetWedding[];
  try {
    weddings = await getFamilyBudget(db);
  } catch {
    return (
      <main className="sg-host"><div className="sg-host-shell"><HostNav current="budget" /><div className="sg-pagehead"><h1>Finance &amp; vendors</h1></div><div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div></div></main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="budget" />
        {weddings.length === 0 ? (
          <div className="sg-pagehead"><h1>Finance &amp; vendors</h1><p>Your account isn’t set as a family admin for any wedding, so there’s nothing to show here.</p></div>
        ) : (
          weddings.map((w) => <FamilyBudgetWeddingView key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
