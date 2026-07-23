import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getSetupData, type SetupWedding, type SetupEvent } from '@/lib/data/setup';
import { createWedding, addVenue, addEvent, updateEvent } from './actions';

export const dynamic = 'force-dynamic';

const TZS = ['Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
const TYPES = ['pithi', 'haldi', 'mehndi', 'sangeet', 'ceremony', 'reception', 'other'];

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
    <select className="sg-select" name={name} defaultValue={selected}>
      {tzOptions(selected).map((z) => <option key={z} value={z}>{z}</option>)}
    </select>
  );
}
function TypeSelect({ selected }: { selected: string | null }) {
  const sel = selected && TYPES.includes(selected) ? selected : 'other';
  return (
    <select className="sg-select" name="type" defaultValue={sel}>
      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
function VenueSelect({ w, selected }: { w: SetupWedding; selected: string | null }) {
  return (
    <select className="sg-select" name="venue" defaultValue={selected ?? ''}>
      <option value="">— no venue —</option>
      {w.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );
}

function EventRow({ w, e }: { w: SetupWedding; e: SetupEvent }) {
  return (
    <tr>
      <td>
        <strong>{e.functionName ?? '—'}</strong>{e.functionType ? <span className="sg-muted"> · {e.functionType}</span> : null}
        {e.cancelled ? <>{' '}<span className="sg-badge is-off">Cancelled</span></> : null}
      </td>
      <td>{fmt(e.whenInstant, e.tz)}<div className="sg-muted">{e.tz}</div></td>
      <td>{e.venueName ?? '—'}</td>
      <td>
        <details>
          <summary className="sg-getdir">Edit</summary>
          <form action={updateEvent}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="instanceId" value={e.eventInstanceId} />
            <div className="sg-formrow">
              <div className="sg-field"><label>Event name</label><input className="sg-input" name="name" defaultValue={e.functionName ?? ''} /></div>
              <div className="sg-field"><label>Type</label><TypeSelect selected={e.functionType} /></div>
              <div className="sg-field"><label>Date &amp; time</label><input className="sg-input" type="datetime-local" name="wall" defaultValue={toLocalInput(e.wallLocal)} /></div>
              <div className="sg-field"><label>Timezone</label><TzSelect name="tz" selected={e.tz} /></div>
              <div className="sg-field"><label>Venue</label><VenueSelect w={w} selected={e.venueId} /></div>
            </div>
            <div className="sg-formrow" style={{ marginTop: 10 }}>
              <button type="submit" name="cancelled" value={e.cancelled ? 'true' : 'false'} className="sg-btn sg-btn--primary sg-btn--sm">Save changes</button>
              {e.cancelled
                ? <button type="submit" name="cancelled" value="false" className="sg-btn sg-btn--sm">Restore event</button>
                : <button type="submit" name="cancelled" value="true" className="sg-btn sg-btn--danger sg-btn--sm">Cancel event</button>}
            </div>
          </form>
        </details>
      </td>
    </tr>
  );
}

function CreateWeddingForm({ heading, intro }: { heading: string; intro?: string }) {
  return (
    <section className="sg-section">
      <h2>{heading}</h2>
      {intro ? <p className="sg-muted">{intro}</p> : null}
      <form action={createWedding} className="sg-formrow">
        <div className="sg-field"><label>Wedding title *</label><input className="sg-input" name="title" required placeholder="e.g. Aisha & Rohan's Wedding" /></div>
        <div className="sg-field"><label>Couple names</label><input className="sg-input" name="couple" placeholder="Aisha & Rohan" /></div>
        <div className="sg-field"><label>Default timezone</label><TzSelect name="tz" selected="Asia/Kolkata" /></div>
        <div className="sg-field"><label>Start date</label><input className="sg-input" type="date" name="start" /></div>
        <div className="sg-field"><label>End date</label><input className="sg-input" type="date" name="end" /></div>
        <button type="submit" className="sg-btn sg-btn--primary">Create wedding</button>
      </form>
    </section>
  );
}

function WeddingSetup({ w }: { w: SetupWedding }) {
  return (
    <div>
      <div className="sg-pagehead">
        <h1>Set up · {w.title}</h1>
        <p>Default timezone {w.defaultTimezone}{w.startDate ? ` · ${w.startDate}${w.endDate && w.endDate !== w.startDate ? ` – ${w.endDate}` : ''}` : ''}</p>
      </div>

      <section className="sg-section">
        <h2>Venues ({w.venues.length})</h2>
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead><tr><th>Name</th><th>Timezone</th><th>Address</th></tr></thead>
            <tbody>
              {w.venues.length === 0
                ? <tr><td colSpan={3}><span className="sg-muted">No venues yet — add one below (events can reference it).</span></td></tr>
                : w.venues.map((v) => <tr key={v.id}><td><strong>{v.name}</strong></td><td>{v.tz}</td><td>{v.address ?? '—'}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sg-section">
        <h2>Add a venue</h2>
        <form action={addVenue} className="sg-formrow">
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <div className="sg-field"><label>Venue name *</label><input className="sg-input" name="name" required placeholder="e.g. The Grand Palace" /></div>
          <div className="sg-field"><label>Timezone</label><TzSelect name="tz" selected={w.defaultTimezone} /></div>
          <div className="sg-field"><label>Address</label><input className="sg-input" name="address" placeholder="optional" /></div>
          <button type="submit" className="sg-btn sg-btn--primary">Add venue</button>
        </form>
      </section>

      <section className="sg-section">
        <h2>Events ({w.events.length})</h2>
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead><tr><th>Event</th><th>When</th><th>Venue</th><th></th></tr></thead>
            <tbody>
              {w.events.length === 0
                ? <tr><td colSpan={4}><span className="sg-muted">No events yet — add your first below.</span></td></tr>
                : w.events.map((e) => <EventRow key={e.eventInstanceId} w={w} e={e} />)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sg-section">
        <h2>Add an event</h2>
        <form action={addEvent} className="sg-formrow">
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <div className="sg-field"><label>Event name *</label><input className="sg-input" name="name" required placeholder="e.g. Sangeet" /></div>
          <div className="sg-field"><label>Type</label><TypeSelect selected="sangeet" /></div>
          <div className="sg-field"><label>Date &amp; time *</label><input className="sg-input" type="datetime-local" name="wall" required /></div>
          <div className="sg-field"><label>Timezone</label><TzSelect name="tz" selected={w.defaultTimezone} /></div>
          <div className="sg-field"><label>Venue</label><VenueSelect w={w} selected={null} /></div>
          <button type="submit" className="sg-btn sg-btn--primary">Add event</button>
        </form>
      </section>
    </div>
  );
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/setup');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: SetupWedding[];
  try {
    weddings = await getSetupData(db);
  } catch {
    return (
      <main className="sg-host">
        <div className="sg-host-shell">
          <div className="sg-pagehead"><h1>Set up a wedding</h1></div>
          <div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <header className="sg-host-head">
          <nav className="sg-hostnav">
            <span className="sg-brand">Sangam</span>
            <a href="/host">Dashboard</a>
            <a href="/host/setup" aria-current="page">Venues &amp; events</a>
            <a href="/host/manage">Guests</a>
            <a href="/host/groups">Families &amp; admins</a>
            <a href="/host/finance">Finance</a>
          </nav>
          <form action="/auth/signout" method="post"><button type="submit" className="sg-signout">Sign out</button></form>
        </header>

        {banner ? (
          <div className={'sg-banner ' + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div>
        ) : null}

        {weddings.length === 0 ? (
          <div>
            <div className="sg-pagehead">
              <h1>Create your wedding</h1>
              <p>
                You’re not set up as an organizer yet. Create a wedding below — you’ll become its owner, and then you can
                add venues, events, and guests, all from here. No SQL required.
              </p>
            </div>
            <CreateWeddingForm heading="New wedding" />
          </div>
        ) : (
          <>
            {weddings.map((w) => <WeddingSetup key={w.weddingId} w={w} />)}
            <details>
              <summary className="sg-getdir">+ Create another wedding</summary>
              <div style={{ marginTop: 12 }}><CreateWeddingForm heading="New wedding" intro="You’ll be its owner." /></div>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
