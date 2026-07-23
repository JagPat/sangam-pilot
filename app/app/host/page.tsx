import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getHostDashboard, type WeddingDashboard, type EventRollup } from '@/lib/data/host';

export const dynamic = 'force-dynamic'; // per-request: reads the owner's session + owner-scoped rows.

const wrap = { padding: 24, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#111' } as const;
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e5e5', fontSize: 13, color: '#555', whiteSpace: 'nowrap' } as const;
const td = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: 14, verticalAlign: 'top' } as const;
const tile = { flex: '1 1 120px', minWidth: 120, background: '#fafafa', border: '1px solid #eee', borderRadius: 10, padding: '12px 14px' } as const;
const num = { fontSize: 26, fontWeight: 700, lineHeight: 1.1 } as const;
const cap = { fontSize: 12, color: '#777', marginTop: 2 } as const;

function fmt(instant: string | null, tz: string): string {
  if (!instant) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(instant));
  } catch {
    return instant;
  }
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  accepted: { label: 'Attending', bg: '#e6f4ea', fg: '#137333' },
  declined: { label: 'Not attending', bg: '#fce8e6', fg: '#b00020' },
  tentative: { label: 'Maybe', bg: '#fef7e0', fg: '#8a6d00' },
  'no response': { label: 'No response', bg: '#f1f3f4', fg: '#5f6368' },
};

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS['no response'];
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function EventTable({ events }: { events: EventRollup[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={th}>Event</th><th style={th}>When</th><th style={th}>Venue</th>
          <th style={{ ...th, textAlign: 'right' }}>Attending</th>
          <th style={{ ...th, textAlign: 'right' }}>Maybe</th>
          <th style={{ ...th, textAlign: 'right' }}>Declined</th>
          <th style={{ ...th, textAlign: 'right' }}>No reply</th>
          <th style={{ ...th, textAlign: 'right' }}>Invited</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.eventInstanceId}>
            <td style={td}><strong>{e.functionName ?? '—'}</strong>{e.functionType ? <span style={{ color: '#999' }}> · {e.functionType}</span> : null}</td>
            <td style={td}>{fmt(e.arrivalInstant, e.tz)}</td>
            <td style={td}>{e.venueName ?? '—'}</td>
            <td style={{ ...td, textAlign: 'right', color: '#137333', fontWeight: 700 }}>{e.accepted}</td>
            <td style={{ ...td, textAlign: 'right', color: '#8a6d00' }}>{e.tentative}</td>
            <td style={{ ...td, textAlign: 'right', color: '#b00020' }}>{e.declined}</td>
            <td style={{ ...td, textAlign: 'right', color: '#888' }}>{e.noResponse}</td>
            <td style={{ ...td, textAlign: 'right' }}>{e.invited}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DietaryTable({ events }: { events: EventRollup[] }) {
  const withDiet = events.filter((e) => e.dietary.length > 0);
  if (withDiet.length === 0) {
    return <p style={{ color: '#777', fontSize: 14 }}>No dietary breakdown yet — it fills in as attending guests set their food preferences. (Counts cover guests marked <em>Attending</em>.)</p>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr><th style={th}>Event</th><th style={th}>Category</th><th style={{ ...th, textAlign: 'right' }}>Head count</th></tr></thead>
      <tbody>
        {withDiet.flatMap((e) =>
          e.dietary.map((d, i) => (
            <tr key={`${e.eventInstanceId}:${d.category}`}>
              <td style={td}>{i === 0 ? e.functionName ?? '—' : ''}</td>
              <td style={td}>{d.category}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{d.headCount}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{title}</h2>
      {note ? <p style={{ margin: '0 0 10px', color: '#777', fontSize: 13 }}>{note}</p> : null}
      {children}
    </section>
  );
}

function WeddingBlock({ w }: { w: WeddingDashboard }) {
  const allEvents = w.events.map((e) => e.functionName).filter(Boolean);
  return (
    <div style={{ marginBottom: 40 }}>
      <h1 style={{ margin: '0 0 2px' }}>{w.title}</h1>
      <div style={{ color: '#777', marginBottom: 16 }}>
        {w.coupleNames ? <span>{w.coupleNames} · </span> : null}
        {w.startDate ?? '—'}{w.endDate && w.endDate !== w.startDate ? ` – ${w.endDate}` : ''}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={tile}><div style={num}>{w.totalGuests}</div><div style={cap}>Guests</div></div>
        <div style={tile}><div style={num}>{w.events.length}</div><div style={cap}>Events</div></div>
        <div style={tile}><div style={num}>{w.totalInvitations}</div><div style={cap}>Invitations</div></div>
        <div style={tile}><div style={num}>{w.totalResponded}</div><div style={cap}>Responses in</div></div>
        <div style={tile}>
          <div style={num}>{w.totalInvitations ? Math.round((w.totalResponded / w.totalInvitations) * 100) : 0}%</div>
          <div style={cap}>Response rate</div>
        </div>
      </div>

      <Section title="RSVPs by event" note="Live counts, scoped to your wedding by the database.">
        <EventTable events={w.events} />
      </Section>

      <Section title="Catering / dietary head count">
        <DietaryTable events={w.events} />
      </Section>

      <Section title={`Guests (${w.guests.length})`} note="Each guest and how they've replied to every event they're invited to.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Guest</th><th style={th}>Responses</th></tr></thead>
          <tbody>
            {w.guests.map((g) => (
              <tr key={g.guestId}>
                <td style={td}><strong>{g.guestName ?? '—'}</strong></td>
                <td style={td}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {g.responses.length === 0 ? <span style={{ color: '#999' }}>Not invited to any event yet</span> : g.responses.map((r) => (
                      <div key={r.eventInstanceId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ minWidth: 130, color: '#444' }}>{r.functionName ?? '—'}</span>
                        <Badge status={r.status} />
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export default async function HostPage() {
  const user = await requireVerifiedUser('/host');

  const db = await pageClient();
  let dashboards: WeddingDashboard[];
  try {
    dashboards = await getHostDashboard(db);
  } catch {
    return (
      <main style={wrap}>
        <h1>Organizer dashboard</h1>
        <p style={{ color: '#b00020' }}>We couldn’t load the dashboard right now. Please refresh in a moment.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#777' }}>Organizer view · {user.email}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dashboards.length > 0 ? (
            <>
              <Link href="/host/setup" style={{ fontSize: 13, padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#1d3b5c' }}>Venues &amp; events</Link>
              <Link href="/host/groups" style={{ fontSize: 13, padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#1d3b5c' }}>Families &amp; admins</Link>
              <Link href="/host/finance" style={{ fontSize: 13, padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#1d3b5c' }}>Finance</Link>
              <Link href="/host/manage" style={{ fontSize: 13, padding: '6px 12px', background: '#1d3b5c', color: '#fff', borderRadius: 6, textDecoration: 'none' }}>Manage guests &amp; invitations →</Link>
            </>
          ) : null}
          <form action="/auth/signout" method="post">
            <button type="submit" style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>Sign out</button>
          </form>
        </div>
      </header>

      {dashboards.length === 0 ? (
        <div>
          <h1>Organizer dashboard</h1>
          <p style={{ color: '#555', maxWidth: 620 }}>
            You’re not set up as an organizer for any wedding yet. You can create one now — you’ll become its owner and
            can add venues, events, and guests, all from here.
          </p>
          <Link href="/host/setup" style={{ display: 'inline-block', marginTop: 8, fontSize: 14, padding: '8px 16px', background: '#1d3b5c', color: '#fff', borderRadius: 6, textDecoration: 'none' }}>Create a wedding →</Link>
        </div>
      ) : (
        dashboards.map((w) => <WeddingBlock key={w.weddingId} w={w} />)
      )}
    </main>
  );
}
