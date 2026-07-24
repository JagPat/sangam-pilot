import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getStayData, type StayWedding } from '@/lib/data/stay';
import { StayWeddingView } from './StayView';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  name: { kind: 'err', text: 'Please enter a name.' },
  rooms: { kind: 'err', text: 'Pick a hotel and room type first.' },
  alloc: { kind: 'err', text: "Couldn't allocate that room — please try again." },
  occupied: { kind: 'err', text: 'That room is already taken by another household.' },
  full: { kind: 'err', text: 'That room is already full.' },
  guestbusy: { kind: 'err', text: 'That guest is already a roommate in another room.' },
  save: { kind: 'err', text: "Couldn't save — please try again." },
};

export default async function StayPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/stay');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: StayWedding[];
  try {
    weddings = await getStayData(db);
  } catch {
    return (
      <main className="sg-host"><div className="sg-host-shell"><HostNav current="stay" /><div className="sg-pagehead"><h1>Stay &amp; Travel</h1></div><div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div></div></main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="stay" />
        {banner ? <div className={'sg-banner ' + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div> : null}
        {weddings.length === 0 ? (
          <div className="sg-pagehead"><h1>Stay &amp; Travel</h1><p>Your account isn’t set as the event manager (wedding owner) for any wedding yet, so there’s nothing to manage here.</p></div>
        ) : (
          weddings.map((w) => <StayWeddingView key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
