import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getMyStay, type MyStayData } from '@/lib/data/mystay';
import { GuestTopbar } from '../GuestTopbar';
import { MyStayView } from './MyStayView';

export const dynamic = 'force-dynamic'; // per-request: reads the session + the guest's own stay/travel rows.

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  save: { kind: 'err', text: "Couldn't save — please try again." },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sg-guest">
      <div className="sg-shell">{children}</div>
    </main>
  );
}

export default async function StayPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireVerifiedUser('/stay'); // redirects to /login if not signed in
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let data: MyStayData;
  try {
    data = await getMyStay(db);
  } catch {
    return (
      <Shell>
        <GuestTopbar current="stay" />
        <div className="sg-empty">
          <div className="sg-empty__title">We couldn’t load your stay</div>
          <p style={{ margin: 0 }}>Please refresh in a moment.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <GuestTopbar current="stay" />

      <header className="sg-hero">
        <div className="sg-eyebrow">Stay &amp; travel</div>
        <h1>Your stay</h1>
        <p>{user.email}</p>
      </header>

      <div className="sg-ornament">
        <span />
        <b>✦</b>
        <span />
      </div>

      {banner ? <div className={'sg-banner ' + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div> : null}

      <MyStayView data={data} />

      <div className="sg-foot">Sangam · two families, one celebration</div>
    </Shell>
  );
}
