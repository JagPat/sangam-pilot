import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getGuestSchedule, type ScheduleItem } from '@/lib/data/schedule';
import ScheduleView from './ScheduleView';

export const dynamic = 'force-dynamic'; // per-request: reads the session + the guest's own rows.

const wrap = { padding: 24, maxWidth: 640, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 } as const;

export default async function SchedulePage() {
  const user = await requireVerifiedUser('/schedule'); // redirects to /login if not signed in

  const db = await pageClient();
  let items: ScheduleItem[];
  try {
    items = await getGuestSchedule(db);
  } catch {
    return (
      <main style={wrap}>
        <h1>Your schedule</h1>
        <p style={{ color: '#b00020' }}>We couldn’t load your schedule right now. Please refresh in a moment.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Your schedule</h1>
          <div style={{ fontSize: 13, color: '#777' }}>{user.email}</div>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
            Sign out
          </button>
        </form>
      </header>

      <ScheduleView items={items} />
    </main>
  );
}
