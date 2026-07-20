import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getManageData, type ManageWedding, type ManageEvent, type ManageGuest } from '@/lib/data/manage';
import { addGuest, updateGuest, inviteGuest, uninviteGuest, removeGuest } from './actions';

export const dynamic = 'force-dynamic';

const wrap = { padding: 24, maxWidth: 1040, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#111' } as const;
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e5e5', fontSize: 12, color: '#555', verticalAlign: 'bottom' } as const;
const td = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: 14, verticalAlign: 'top' } as const;
const input = { padding: '7px 9px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, width: '100%', boxSizing: 'border-box' } as const;
const label = { fontSize: 12, color: '#666', display: 'block', marginBottom: 3 } as const;
const btn = { padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc', background: '#fff' } as const;
const btnPrimary = { ...btn, background: '#1d3b5c', color: '#fff', border: '1px solid #1d3b5c' } as const;
const btnGreen = { ...btn, background: '#137333', color: '#fff', border: '1px solid #137333', padding: '4px 10px', fontSize: 12 } as const;
const btnGhost = { ...btn, padding: '4px 10px', fontSize: 12 } as const;

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  name: { kind: 'err', text: "Please enter the guest's name." },
  household: { kind: 'err', text: 'Choose an existing household or type a new household name.' },
  save: { kind: 'err', text: "Couldn't save — please try again." },
  invite: { kind: 'err', text: "Couldn't update that invitation." },
  uninvite: { kind: 'err', text: "Couldn't remove that invitation." },
  responded: { kind: 'err', text: "That guest has already responded, so they can't be removed from the event — their RSVP (and its audit trail) stays intact. Ask them to change their reply if needed." },
  hasinvites: { kind: 'err', text: 'Remove the guest from their events first, then you can delete them.' },
  remove: { kind: 'err', text: "Couldn't remove that guest." },
};

function fmt(instant: string | null, tz: string): string {
  if (!instant) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(instant));
  } catch {
    return '';
  }
}

function StatusChip({ g }: { g: ManageGuest }) {
  const s = g.bound
    ? { bg: '#e6f4ea', fg: '#137333', label: 'Signed in' }
    : g.email
      ? { bg: '#f1f3f4', fg: '#5f6368', label: 'Invited · not signed in' }
      : { bg: '#fef7e0', fg: '#8a6d00', label: 'No email yet' };
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function EventCell({ w, g, ev }: { w: ManageWedding; g: ManageGuest; ev: ManageEvent }) {
  const invited = g.invited[ev.eventInstanceId];
  const locked = g.locked[ev.eventInstanceId];
  if (invited) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <span style={{ color: '#137333', fontWeight: 600, fontSize: 12 }}>✓ Invited</span>
        {locked ? (
          <span style={{ color: '#8a6d00', fontSize: 11 }} title="Already responded — RSVP preserved">responded 🔒</span>
        ) : (
          <form action={uninviteGuest}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <input type="hidden" name="instanceId" value={ev.eventInstanceId} />
            <button type="submit" style={btnGhost}>Remove</button>
          </form>
        )}
      </div>
    );
  }
  return (
    <form action={inviteGuest}>
      <input type="hidden" name="weddingId" value={w.weddingId} />
      <input type="hidden" name="guestId" value={g.guestId} />
      <input type="hidden" name="householdId" value={g.householdId} />
      <input type="hidden" name="instanceId" value={ev.eventInstanceId} />
      <button type="submit" style={btnGreen}>Invite</button>
    </form>
  );
}

function GuestRow({ w, g }: { w: ManageWedding; g: ManageGuest }) {
  return (
    <tr>
      <td style={td}>
        <div style={{ fontWeight: 600 }}>{g.guestName ?? '—'}</div>
        <div style={{ color: '#777', fontSize: 12 }}>{g.email ?? 'no email'}</div>
        <div style={{ color: '#999', fontSize: 11, marginBottom: 4 }}>{g.householdName ?? ''}</div>
        <StatusChip g={g} />
      </td>
      {w.events.map((ev) => (
        <td key={ev.eventInstanceId} style={{ ...td, textAlign: 'center' }}>
          <EventCell w={w} g={g} ev={ev} />
        </td>
      ))}
      <td style={td}>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#1d3b5c' }}>Edit</summary>
          <form action={updateGuest} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <input type="hidden" name="householdId" value={g.householdId} />
            <div><label style={label}>Name</label><input style={input} name="fullName" defaultValue={g.guestName ?? ''} /></div>
            <div><label style={label}>Sign-in email</label><input style={input} name="email" type="email" defaultValue={g.email ?? ''} placeholder="name@example.com" /></div>
            <button type="submit" style={btnPrimary}>Save changes</button>
          </form>
          <form action={removeGuest} style={{ marginTop: 8 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <button type="submit" style={{ ...btnGhost, color: '#b00020', borderColor: '#e6b4ba' }}>Delete guest</button>
          </form>
        </details>
      </td>
    </tr>
  );
}

function WeddingManage({ w }: { w: ManageWedding }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h1 style={{ margin: '0 0 2px' }}>Manage · {w.title}</h1>
      <p style={{ color: '#777', margin: '0 0 18px', fontSize: 14 }}>
        Add guests with the email their invite will go to, then invite them to events. When a guest signs in with that
        email, they’re linked automatically and see their schedule — no extra step.
      </p>

      <section style={{ background: '#f7f9fb', border: '1px solid #e3ebf2', borderRadius: 10, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Add a guest</h2>
        <form action={addGuest} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <div style={{ flex: '2 1 180px' }}><label style={label}>Full name *</label><input style={input} name="fullName" required placeholder="e.g. Priya Shah" /></div>
          <div style={{ flex: '2 1 180px' }}><label style={label}>Sign-in email</label><input style={input} type="email" name="email" placeholder="name@example.com" /></div>
          <div style={{ flex: '2 1 180px' }}>
            <label style={label}>Household</label>
            <select style={input as React.CSSProperties} name="householdId" defaultValue="">
              <option value="">— create new below —</option>
              {w.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '2 1 180px' }}><label style={label}>…or new household</label><input style={input} name="newHouseholdName" placeholder="e.g. Shah Household" /></div>
          <button type="submit" style={btnPrimary}>Add guest</button>
        </form>
      </section>

      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Guests &amp; invitations ({w.guests.length})</h2>
      {w.events.length === 0 ? (
        <p style={{ color: '#b00020', fontSize: 14 }}>This wedding has no events yet. Events are still set up in SQL (manual §5) for now — that screen is the next step after this one.</p>
      ) : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ ...th, minWidth: 190 }}>Guest</th>
              {w.events.map((ev) => (
                <th key={ev.eventInstanceId} style={{ ...th, textAlign: 'center' }}>
                  <div>{ev.functionName ?? '—'}</div>
                  <div style={{ fontWeight: 400, color: '#999' }}>{fmt(ev.whenInstant, ev.tz)}</div>
                </th>
              ))}
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {w.guests.length === 0 ? (
              <tr><td style={td} colSpan={w.events.length + 2}><span style={{ color: '#999' }}>No guests yet — add your first above.</span></td></tr>
            ) : (
              w.guests.map((g) => <GuestRow key={g.guestId} w={w} g={g} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/manage');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: ManageWedding[];
  try {
    weddings = await getManageData(db);
  } catch {
    return (
      <main style={wrap}>
        <h1>Manage guests</h1>
        <p style={{ color: '#b00020' }}>We couldn’t load this page right now. Please refresh in a moment.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Link href="/host" style={{ fontSize: 13, color: '#1d3b5c' }}>← Back to dashboard</Link>
        <form action="/auth/signout" method="post"><button type="submit" style={btn}>Sign out</button></form>
      </header>

      {banner ? (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: 14,
          background: banner.kind === 'ok' ? '#e6f4ea' : '#fce8e6', color: banner.kind === 'ok' ? '#137333' : '#b00020',
          border: `1px solid ${banner.kind === 'ok' ? '#b7e1c1' : '#f2c2c2'}` }}>
          {banner.text}
        </div>
      ) : null}

      {weddings.length === 0 ? (
        <div>
          <h1>Manage guests</h1>
          <p style={{ color: '#555' }}>Your account isn’t set as an organizer (wedding owner) for any wedding yet, so there’s nothing to manage.</p>
        </div>
      ) : (
        weddings.map((w) => <WeddingManage key={w.weddingId} w={w} />)
      )}
    </main>
  );
}
