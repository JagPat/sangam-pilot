import { pageClient } from '@/lib/supabase/pageClient';
import { getOrganizerNav } from '@/lib/data/nav';

// Shared top bar for the guest-facing app (schedule + directory). It also carries the VIEW SWITCH: an
// account that is a wedding owner (the event manager) is usually also a guest, so from their schedule they
// need a way over to the organizer console. GuestTopbar (async) detects that and shows the switch;
// GuestTopbarView is the presentational half so it can be previewed with fixtures.

export function GuestTopbarView({
  current,
  showConsole,
}: {
  current: 'schedule' | 'directory' | 'stay';
  showConsole: boolean;
}) {
  return (
    <div className="sg-topbar">
      <a href="/schedule" className="sg-brand" style={{ textDecoration: 'none' }}>Sangam</a>
      <nav className="sg-guestnav">
        <a href="/schedule" className={current === 'schedule' ? 'is-current' : undefined}>Schedule</a>
        <a href="/stay" className={current === 'stay' ? 'is-current' : undefined}>Stay</a>
        <a href="/directory" className={current === 'directory' ? 'is-current' : undefined}>Guests</a>
        {showConsole ? (
          <a href="/host" className="sg-switch">Organizer console →</a>
        ) : null}
      </nav>
      <form action="/auth/signout" method="post">
        <button type="submit" className="sg-signout">Sign out</button>
      </form>
    </div>
  );
}

export async function GuestTopbar({ current }: { current: 'schedule' | 'directory' | 'stay' }) {
  let showConsole = false;
  try {
    const nav = await getOrganizerNav(await pageClient());
    showConsole = nav.sections.length > 0; // owner → has console sections
  } catch {
    /* nav switch is best-effort; never break the guest header over it */
  }
  return <GuestTopbarView current={current} showConsole={showConsole} />;
}
