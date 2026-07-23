import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getHostDashboard, type WeddingDashboard, type EventRollup } from '@/lib/data/host';

export const dynamic = 'force-dynamic'; // per-request: reads the owner's session + owner-scoped rows.

function fmt(instant: string | null, tz: string): string {
  if (!instant) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(instant));
  } catch {
    return instant;
  }
}

const STATUS: Record<string, { label: string; cls: string }> = {
  accepted: { label: 'Attending', cls: 'is-attending' },
  declined: { label: 'Not attending', cls: 'is-declined' },
  tentative: { label: 'Maybe', cls: 'is-maybe' },
  'no response': { label: 'No response', cls: 'is-none' },
};

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS['no response'];
  return <span className={`sg-pill ${s.cls}`}>{s.label}</span>;
}

function HostHead() {
  return (
    <header className="sg-host-head">
      <nav className="sg-hostnav">
        <span className="sg-brand">Sangam</span>
        <Link href="/host" aria-current="page">Dashboard</Link>
        <Link href="/host/setup">Venues &amp; events</Link>
        <Link href="/host/manage">Guests</Link>
        <Link href="/host/groups">Families &amp; admins</Link>
        <Link href="/host/finance">Finance</Link>
      </nav>
      <form action="/auth/signout" method="post"><button type="submit" className="sg-signout">Sign out</button></form>
    </header>
  );
}

function EventTable({ events }: { events: EventRollup[] }) {
  return (
    <div className="sg-tablewrap">
      <table className="sg-table">
        <thead>
          <tr>
            <th>Event</th><th>When</th><th>Venue</th>
            <th>Attending</th><th>Maybe</th><th>Declined</th><th>No reply</th><th>Invited</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.eventInstanceId}>
              <td><strong>{e.functionName ?? '—'}</strong>{e.functionType ? <span className="sg-muted"> · {e.functionType}</span> : null}</td>
              <td>{fmt(e.arrivalInstant, e.tz)}</td>
              <td>{e.venueName ?? '—'}</td>
              <td>{e.accepted}</td>
              <td>{e.tentative}</td>
              <td>{e.declined}</td>
              <td>{e.noResponse}</td>
              <td>{e.invited}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DietaryTable({ events }: { events: EventRollup[] }) {
  const withDiet = events.filter((e) => e.dietary.length > 0);
  if (withDiet.length === 0) {
    return <p className="sg-muted">No dietary breakdown yet — it fills in as attending guests set their food preferences. (Counts cover guests marked <em>Attending</em>.)</p>;
  }
  return (
    <div className="sg-tablewrap">
      <table className="sg-table">
        <thead><tr><th>Event</th><th>Category</th><th>Head count</th></tr></thead>
        <tbody>
          {withDiet.flatMap((e) =>
            e.dietary.map((d, i) => (
              <tr key={`${e.eventInstanceId}:${d.category}`}>
                <td>{i === 0 ? e.functionName ?? '—' : ''}</td>
                <td>{d.category}</td>
                <td>{d.headCount}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="sg-section">
      <h2>{title}</h2>
      {note ? <p className="sg-muted">{note}</p> : null}
      {children}
    </section>
  );
}

function WeddingBlock({ w }: { w: WeddingDashboard }) {
  const allEvents = w.events.map((e) => e.functionName).filter(Boolean);
  return (
    <div>
      <div className="sg-pagehead">
        <h1>{w.title}</h1>
        <p>
          {w.coupleNames ? <span>{w.coupleNames} · </span> : null}
          {w.startDate ?? '—'}{w.endDate && w.endDate !== w.startDate ? ` – ${w.endDate}` : ''}
        </p>
      </div>

      <div className="sg-tiles">
        <div className="sg-tile"><div className="sg-tile__num">{w.totalGuests}</div><div className="sg-tile__label">Guests</div></div>
        <div className="sg-tile"><div className="sg-tile__num">{w.events.length}</div><div className="sg-tile__label">Events</div></div>
        <div className="sg-tile"><div className="sg-tile__num">{w.totalInvitations}</div><div className="sg-tile__label">Invitations</div></div>
        <div className="sg-tile"><div className="sg-tile__num">{w.totalResponded}</div><div className="sg-tile__label">Responses in</div></div>
        <div className="sg-tile">
          <div className="sg-tile__num">{w.totalInvitations ? Math.round((w.totalResponded / w.totalInvitations) * 100) : 0}%</div>
          <div className="sg-tile__label">Response rate</div>
        </div>
      </div>

      <Section title="RSVPs by event" note="Live counts, scoped to your wedding by the database.">
        <EventTable events={w.events} />
      </Section>

      <Section title="Catering / dietary head count">
        <DietaryTable events={w.events} />
      </Section>

      <Section title={`Guests (${w.guests.length})`} note="Each guest and how they've replied to every event they're invited to.">
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead><tr><th>Guest</th><th>Responses</th></tr></thead>
            <tbody>
              {w.guests.map((g) => (
                <tr key={g.guestId}>
                  <td><strong>{g.guestName ?? '—'}</strong></td>
                  <td>
                    {g.responses.length === 0 ? (
                      <span className="sg-muted">Not invited to any event yet</span>
                    ) : (
                      g.responses.map((r) => (
                        <div key={r.eventInstanceId}>
                          <span className="sg-muted">{r.functionName ?? '—'}</span> <Badge status={r.status} />
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

export default async function HostPage() {
  await requireVerifiedUser('/host');

  const db = await pageClient();
  let dashboards: WeddingDashboard[];
  try {
    dashboards = await getHostDashboard(db);
  } catch {
    return (
      <main className="sg-host">
        <div className="sg-host-shell">
          <HostHead />
          <div className="sg-pagehead"><h1>Organizer dashboard</h1></div>
          <div className="sg-banner is-err">We couldn’t load the dashboard right now. Please refresh in a moment.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostHead />
        {dashboards.length === 0 ? (
          <div className="sg-empty">
            <h1 className="sg-empty__title">Organizer dashboard</h1>
            <p>
              You’re not set up as an organizer for any wedding yet. You can create one now — you’ll become its owner and
              can add venues, events, and guests, all from here.
            </p>
            <Link href="/host/setup" className="sg-btn sg-btn--primary">Create a wedding →</Link>
          </div>
        ) : (
          dashboards.map((w) => <WeddingBlock key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
