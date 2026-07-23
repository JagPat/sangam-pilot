// Shared top bar for the guest-facing app (schedule + directory). Keeps the two screens on one
// consistent header with a light nav. Sign-out posts to the existing /auth/signout route.

export function GuestTopbar({ current }: { current: 'schedule' | 'directory' }) {
  return (
    <div className="sg-topbar">
      <span className="sg-brand">Sangam</span>
      <nav className="sg-guestnav">
        <a href="/schedule" className={current === 'schedule' ? 'is-current' : ''}>Schedule</a>
        <a href="/directory" className={current === 'directory' ? 'is-current' : ''}>Guests</a>
      </nav>
      <form action="/auth/signout" method="post">
        <button type="submit" className="sg-signout">Sign out</button>
      </form>
    </div>
  );
}
