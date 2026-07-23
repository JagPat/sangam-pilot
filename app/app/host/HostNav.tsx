// Shared organizer header/nav — one source of truth for the host navigation, so adding a screen (e.g.
// Vendors) is a one-line change here instead of an edit in every page.
const LINKS: { href: string; label: string; key: string }[] = [
  { href: '/host', label: 'Dashboard', key: 'dashboard' },
  { href: '/host/setup', label: 'Venues & events', key: 'setup' },
  { href: '/host/manage', label: 'Guests', key: 'manage' },
  { href: '/host/groups', label: 'Families & admins', key: 'groups' },
  { href: '/host/vendors', label: 'Vendors', key: 'vendors' },
  { href: '/host/finance', label: 'Finance', key: 'finance' },
];

export function HostNav({ current }: { current: string }) {
  return (
    <header className="sg-host-head">
      <nav className="sg-hostnav">
        <span className="sg-brand">Sangam</span>
        {LINKS.map((l) =>
          l.key === current ? (
            <a key={l.key} href={l.href} aria-current="page">{l.label}</a>
          ) : (
            <a key={l.key} href={l.href}>{l.label}</a>
          ),
        )}
      </nav>
      <form action="/auth/signout" method="post"><button type="submit" className="sg-signout">Sign out</button></form>
    </header>
  );
}
