import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getSetupData, type SetupWedding, type SetupEvent } from '@/lib/data/setup';
import { createWedding, addVenue, addEvent, updateEvent } from './actions';

export const dynamic = 'force-dynamic';

const TZS = ['Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
const TYPES = ['pithi', 'haldi', 'mehndi', 'sangeet', 'ceremony', 'reception', 'other'];

const wrap = { padding: 24, maxWidth: 1040, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#111' } as const;
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e5e5', fontSize: 12, color: '#555' } as const;
const td = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: 14, verticalAlign: 'top' } as const;
const input = { padding: '7px 9px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, width: '100%', boxSizing: 'border-box' } as const;
const label = { fontSize: 12, color: '#666', display: 'block', marginBottom: 3 } as const;
const btn = { padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc', background: '#fff' } as const;
const btnPrimary = { ...btn, background: '#1d3b5c', color: '#fff', border: '1px solid #1d3b5c' } as const;
const card = { background: '#f7f9fb', border: '1px solid #e3ebf2', borderRadius: 10, padding: 16, marginBottom: 20 } as const;

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  title: { kind: 'err', text: 'Please give the wedding a title.' },
  venue: { kind: 'err', text: 'A venue needs a name.' },
  event: { kind: 'err', text: 'An event needs a name and a date/time.' },
  save: { kind: 'err', text: "Couldn't save — please check the details and try again." },
};

function fmt(instant: string | null, tz: string): string {
  if (!instant) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(instant));
  } catch {
    return instant;
  }
}
// DB wall_local -> datetime-local input value (YYYY-MM-DDTHH:mm)
function toLocalInput(wall: string | null): string {
  if (!wall) return '';
  return wall.replace(' ', 'T').slice(0, 16);
}
function tzOptions(selected: string): string[] {
  return [...new Set([selected, ...TZS])];
}

function TzSelect({ name, selected }: { name: string; selected: string }) {
  return (
    <select style={input as React.CSSProperties} name={name} defaultValue={selected}>
      {tzOptions(selected).map((z) => <option key={z} value={z}>{z}</option>)}
    </select>
  );
}
function TypeSelect({ selected }: { selected: string | null }) {
  const sel = selected && TYPES.includes(selected) ? selected : 'other';
  return (
    <select style={input as React.CSSProperties} name="type" defaultValue={sel}>
      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
function VenueSelect({ w, selected }: { w: SetupWedding; selected: string | null }) {
  return (
    <select style={input as React.CSSProperties} name="venue" defaultValue={selected ?? ''}>
      <option value="">— no venue —</option>
      {w.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );
}

function EventRow({ w, e }: { w: SetupWedding; e: SetupEvent }) {
  return (
    <tr style={e.cancelled ? { opacity: 0.6 } : undefined}>
      <td style={td}>
        <strong>{e.functionName ?? '—'}</strong>{e.functionType ? <span style={{ color: '#999' }}> · {e.functionType}</span> : null}
        {e.cancelled ? <span style={{ marginLeft: 8, background: '#fce8e6', color: '#b00020', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>Cancelled</span> : null}
      </td>
      <td style={td}>{fmt(e.whenInstant, e.tz)}<div style={{ color: '#999', fontSize: 11 }}>{e.tz}</div></td>
      <td style={td}>{e.venueName ?? '—'}</td>
      <td style={td}>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#1d3b5c' }}>Edit</summary>
          <form action={updateEvent} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="instanceId" value={e.eventInstanceId} />
            <div><label style={label}>Event name</label><input style={input} name="name" defaultValue={e.functionName ?? ''} /></div>
            <div><label style={label}>Type</label><TypeSelect selected={e.functionType} /></div>
            <div><label style={label}>Date &amp; time</label><input style={input} type="datetime-local" name="wall" defaultValue={toLocalInput(e.wallLocal)} /></div>
            <div><label style={label}>Timezone</label><TzSelect name="tz" selected={e.tz} /></div>
            <div><label style={label}>Venue</label><VenueSelect w={w} selected={e.venueId} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" name="cancelled" value={e.cancelled ? 'true' : 'false'} style={btnPrimary}>Save changes</button>
              {e.cancelled
                ? <button type="submit" name="cancelled" value="false" style={btn}>Restore event</button>
                : <button type="submit" name="cancelled" value="true" style={{ ...btn, color: '#b00020', borderColor: '#e6b4ba' }}>Cancel event</button>}
            </div>
          </form>
        </details>
      </td>
    </tr>
  );
}

function CreateWeddingForm({ heading, intro }: { heading: string; intro?: string }) {
  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>{heading}</h2>
      {intro ? <p style={{ margin: '0 0 10px', color: '#666', fontSize: 13 }}>{intro}</p> : null}
      <form action={createWedding} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '2 1 200px' }}><label style={label}>Wedding title *</label><input style={input} name="title" required placeholder="e.g. Aisha & Rohan's Wedding" /></div>
        <div style={{ flex: '2 1 160px' }}><label style={label}>Couple names</label><input style={input} name="couple" placeholder="Aisha & Rohan" /></div>
        <div style={{ flex: '1 1 160px' }}><label style={label}>Default timezone</label><TzSelect name="tz" selected="Asia/Kolkata" /></div>
        <div style={{ flex: '1 1 120px' }}><label style={label}>Start date</label><input style={input} type="date" name="start" /></div>
        <div style={{ flex: '1 1 120px' }}><label style={label}>End date</label><input style={input} type="date" name="end" /></div>
        <button type="submit" style={btnPrimary}>Create wedding</button>
      </form>
    </section>
  );
}

function WeddingSetup({ w }: { w: SetupWedding }) {
  return (
    <div style={{ marginBottom: 44 }}>
      <h1 style={{ margin: '0 0 2px' }}>Set up · {w.title}</h1>
      <div style={{ color: '#777', marginBottom: 16, fontSize: 14 }}>
        Default timezone {w.defaultTimezone}{w.startDate ? ` · ${w.startDate}${w.endDate && w.endDate !== w.startDate ? ` – ${w.endDate}` : ''}` : ''}
      </div>

      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Venues ({w.venues.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr><th style={th}>Name</th><th style={th}>Timezone</th><th style={th}>Address</th></tr></thead>
        <tbody>
          {w.venues.length === 0
            ? <tr><td style={td} colSpan={3}><span style={{ color: '#999' }}>No venues yet — add one below (events can reference it).</span></td></tr>
            : w.venues.map((v) => <tr key={v.id}><td style={td}><strong>{v.name}</strong></td><td style={td}>{v.tz}</td><td style={td}>{v.address ?? '—'}</td></tr>)}
        </tbody>
      </table>
      <form action={addVenue} style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 28 }}>
        <input type="hidden" name="weddingId" value={w.weddingId} />
        <div style={{ flex: '2 1 200px' }}><label style={label}>Venue name *</label><input style={input} name="name" required placeholder="e.g. The Grand Palace" /></div>
        <div style={{ flex: '1 1 160px' }}><label style={label}>Timezone</label><TzSelect name="tz" selected={w.defaultTimezone} /></div>
        <div style={{ flex: '2 1 200px' }}><label style={label}>Address</label><input style={input} name="address" placeholder="optional" /></div>
        <button type="submit" style={btnPrimary}>Add venue</button>
      </form>

      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Events ({w.events.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr><th style={th}>Event</th><th style={th}>When</th><th style={th}>Venue</th><th style={th}></th></tr></thead>
        <tbody>
          {w.events.length === 0
            ? <tr><td style={td} colSpan={4}><span style={{ color: '#999' }}>No events yet — add your first below.</span></td></tr>
            : w.events.map((e) => <EventRow key={e.eventInstanceId} w={w} e={e} />)}
        </tbody>
      </table>
      <form action={addEvent} style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <input type="hidden" name="weddingId" value={w.weddingId} />
        <div style={{ flex: '2 1 180px' }}><label style={label}>Event name *</label><input style={input} name="name" required placeholder="e.g. Sangeet" /></div>
        <div style={{ flex: '1 1 130px' }}><label style={label}>Type</label><TypeSelect selected="sangeet" /></div>
        <div style={{ flex: '1 1 180px' }}><label style={label}>Date &amp; time *</label><input style={input} type="datetime-local" name="wall" required /></div>
        <div style={{ flex: '1 1 150px' }}><label style={label}>Timezone</label><TzSelect name="tz" selected={w.defaultTimezone} /></div>
        <div style={{ flex: '1 1 150px' }}><label style={label}>Venue</label><VenueSelect w={w} selected={null} /></div>
        <button type="submit" style={btnPrimary}>Add event</button>
      </form>
    </div>
  );
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireVerifiedUser('/host/setup');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: SetupWedding[];
  try {
    weddings = await getSetupData(db);
  } catch {
    return (
      <main style={wrap}>
        <h1>Set up a wedding</h1>
        <p style={{ color: '#b00020' }}>We couldn’t load this page right now. Please refresh in a moment.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
          {weddings.length > 0 ? <Link href="/host" style={{ fontSize: 13, color: '#1d3b5c' }}>← Dashboard</Link> : null}
          {weddings.length > 0 ? <Link href="/host/manage" style={{ fontSize: 13, color: '#1d3b5c' }}>Guests &amp; invitations</Link> : null}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#777' }}>{user.email}</span>
          <form action="/auth/signout" method="post"><button type="submit" style={btn}>Sign out</button></form>
        </div>
      </header>

      {banner ? (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: 14,
          background: banner.kind === 'ok' ? '#e6f4ea' : '#fce8e6', color: banner.kind === 'ok' ? '#137333' : '#b00020',
          border: `1px solid ${banner.kind === 'ok' ? '#b7e1c1' : '#f2c2c2'}` }}>{banner.text}</div>
      ) : null}

      {weddings.length === 0 ? (
        <div>
          <h1 style={{ marginTop: 0 }}>Create your wedding</h1>
          <p style={{ color: '#555', maxWidth: 640 }}>
            You’re not set up as an organizer yet. Create a wedding below — you’ll become its owner, and then you can
            add venues, events, and guests, all from here. No SQL required.
          </p>
          <CreateWeddingForm heading="New wedding" />
        </div>
      ) : (
        <>
          {weddings.map((w) => <WeddingSetup key={w.weddingId} w={w} />)}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 14, color: '#1d3b5c', marginTop: 8 }}>+ Create another wedding</summary>
            <div style={{ marginTop: 12 }}><CreateWeddingForm heading="New wedding" intro="You’ll be its owner." /></div>
          </details>
        </>
      )}
    </main>
  );
}
