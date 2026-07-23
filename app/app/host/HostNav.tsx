import { pageClient } from '@/lib/supabase/pageClient';
import { getOrganizerNav, type NavSection } from '@/lib/data/nav';

// Organizer console header + navigation. The MENU IS ROLE-AWARE: HostNav (async) loads the signed-in
// user's accessible sections via getOrganizerNav and renders them. HostNavView is the presentational
// half (so it can be previewed with fixtures). One source of truth for the console chrome.

export function HostNavView({
  current,
  email,
  roleLabel,
  sections,
}: {
  current: string;
  email: string | null;
  roleLabel: string | null;
  sections: NavSection[];
}) {
  return (
    <header className="sg-nav">
      <div className="sg-nav__bar">
        <a href="/host" className="sg-nav__brand" aria-label="Sangam — organizer console">
          <span className="sg-nav__mark">Sangam</span>
          <span className="sg-nav__sub">Organizer console</span>
        </a>
        <div className="sg-nav__who">
          {email ? (
            <span className="sg-nav__id">
              {roleLabel ? <b>{roleLabel}</b> : null}
              <span>{email}</span>
            </span>
          ) : null}
          <form action="/auth/signout" method="post">
            <button type="submit" className="sg-signout">Sign out</button>
          </form>
        </div>
      </div>

      {sections.length ? (
        <nav className="sg-nav__tabs" aria-label="Sections">
          {sections.map((l) => (
            <a
              key={l.key}
              href={l.href}
              className={l.key === current ? 'is-active' : undefined}
              aria-current={l.key === current ? 'page' : undefined}
            >
              {l.label}
            </a>
          ))}
        </nav>
      ) : (
        <div className="sg-nav__note">
          Your account doesn’t have any organizer sections yet. If you’re a family admin, ask the event
          manager to finish setting up your access.
        </div>
      )}
    </header>
  );
}

export async function HostNav({ current }: { current: string }) {
  const nav = await getOrganizerNav(await pageClient());
  return <HostNavView current={current} email={nav.email} roleLabel={nav.roleLabel} sections={nav.sections} />;
}
