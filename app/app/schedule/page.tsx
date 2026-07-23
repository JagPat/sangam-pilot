import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getGuestSchedule, type ScheduleItem } from '@/lib/data/schedule';
import ScheduleView from './ScheduleView';
import { GuestTopbar } from '../GuestTopbar';

export const dynamic = 'force-dynamic'; // per-request: reads the session + the guest's own rows.

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sg-guest">
      <div className="sg-shell">{children}</div>
    </main>
  );
}

export default async function SchedulePage() {
  const user = await requireVerifiedUser('/schedule'); // redirects to /login if not signed in

  const db = await pageClient();
  let items: ScheduleItem[];
  try {
    items = await getGuestSchedule(db);
  } catch {
    return (
      <Shell>
        <GuestTopbar current="schedule" />
        <div className="sg-empty">
          <div className="sg-empty__title">We couldn’t load your schedule</div>
          <p style={{ margin: 0 }}>Please refresh in a moment.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <GuestTopbar current="schedule" />

      <header className="sg-hero">
        <div className="sg-eyebrow">Your invitation</div>
        <h1>Your schedule</h1>
        <p>{user.email}</p>
      </header>

      <div className="sg-ornament">
        <span />
        <b>✦</b>
        <span />
      </div>

      <ScheduleView items={items} />

      <div className="sg-foot">Sangam · two families, one celebration</div>
    </Shell>
  );
}
