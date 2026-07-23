import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getGuestDirectory, type DirectoryEntry } from '@/lib/data/directory';
import { GuestTopbar } from '../GuestTopbar';
import DirectoryView from './DirectoryView';

export const dynamic = 'force-dynamic'; // per-request: reads the session + consent-gated directory rows.

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sg-guest">
      <div className="sg-shell">{children}</div>
    </main>
  );
}

export default async function DirectoryPage() {
  await requireVerifiedUser('/directory'); // redirects to /login if not signed in

  const db = await pageClient();
  let entries: DirectoryEntry[];
  try {
    entries = await getGuestDirectory(db);
  } catch {
    return (
      <Shell>
        <GuestTopbar current="directory" />
        <div className="sg-empty">
          <div className="sg-empty__title">We couldn’t load the directory</div>
          <p style={{ margin: 0 }}>Please refresh in a moment.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <GuestTopbar current="directory" />

      <header className="sg-hero">
        <div className="sg-eyebrow">Who’s coming</div>
        <h1>Guest directory</h1>
        <p>The people you’ll be celebrating with. Only names are shown — never contact details.</p>
      </header>

      <div className="sg-ornament">
        <span />
        <b>✦</b>
        <span />
      </div>

      <DirectoryView entries={entries} />

      <div className="sg-foot">Sangam · two families, one celebration</div>
    </Shell>
  );
}
