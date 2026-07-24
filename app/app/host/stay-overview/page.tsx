import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getFamilyStayOverview, type FamilyStayOverview } from '@/lib/data/family-stay';
import { FamilyStayView } from './FamilyStayView';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic';

export default async function StayOverviewPage() {
  await requireVerifiedUser('/host/stay-overview');

  const db = await pageClient();
  let sides: FamilyStayOverview[];
  try {
    sides = await getFamilyStayOverview(db);
  } catch {
    return (
      <main className="sg-host"><div className="sg-host-shell"><HostNav current="stay-overview" /><div className="sg-pagehead"><h1>Stay &amp; travel</h1></div><div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div></div></main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="stay-overview" />
        {sides.length === 0 ? (
          <div className="sg-pagehead"><h1>Stay &amp; travel</h1><p>There’s nothing on your side to show yet. Once your guests have rooms or travel details, they’ll appear here.</p></div>
        ) : (
          sides.map((o) => <FamilyStayView key={o.weddingId} o={o} />)
        )}
      </div>
    </main>
  );
}
