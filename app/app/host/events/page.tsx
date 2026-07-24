import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getFamilyEvents, type FamilyEventsWedding } from '@/lib/data/family-events';
import { FamilyEventsWeddingView } from './FamilyEventsView';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  event: { kind: 'err', text: 'Please enter an event name and time.' },
  save: { kind: 'err', text: "Couldn't save — you can only manage events your side hosts." },
};

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/events');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: FamilyEventsWedding[];
  try {
    weddings = await getFamilyEvents(db);
  } catch {
    return (
      <main className="sg-host"><div className="sg-host-shell"><HostNav current="events" /><div className="sg-pagehead"><h1>Events</h1></div><div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div></div></main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="events" />
        {banner ? <div className={'sg-banner ' + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div> : null}
        {weddings.length === 0 ? (
          <div className="sg-pagehead"><h1>Events</h1><p>Your account isn’t set as a family admin for any wedding, so there are no events to manage here.</p></div>
        ) : (
          weddings.map((w) => <FamilyEventsWeddingView key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
