import { EVENT_TYPES, type FamilyEventsWedding, type FamilyEvent } from '@/lib/data/family-events';
import { createSideEvent, updateSideEvent } from './actions';

// Presentational family-admin events screen (used by /host/events + the fixture preview). Events the caller's
// side hosts are editable; the rest of the schedule shows read-only for context. Forms post to the group_*
// actions; the RPCs (0021) are the real guard.

const TYPE_LABEL: Record<string, string> = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label]));

function toLocalInput(wall: string | null): string {
  if (!wall) return '';
  return wall.replace(' ', 'T').slice(0, 16);
}
function whenLabel(ev: FamilyEvent): string {
  const s = toLocalInput(ev.wallLocal);
  return s ? `${s.slice(0, 10)} · ${s.slice(11, 16)}` : '—';
}

function EnrichmentFields({ ev }: { ev?: FamilyEvent }) {
  return (
    <details style={{ flex: '1 1 100%', marginTop: 4 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--gold-deep)', fontWeight: 600, fontSize: 13 }}>Know-before-you-go (dress code, muhurat, live stream)</summary>
      <div className="sg-formrow" style={{ marginTop: 8 }}>
        <div className="sg-field"><label>Dress code</label><input className="sg-input" name="dress" defaultValue={ev?.dressCode ?? ''} placeholder="e.g. Festive Indian" /></div>
        <div className="sg-field"><label>Muhurat time</label><input className="sg-input" type="datetime-local" name="muhurat" defaultValue={toLocalInput(ev?.muhuratWall ?? null)} /></div>
        <div className="sg-field"><label>Tithi</label><input className="sg-input" name="tithi" defaultValue={ev?.tithiText ?? ''} placeholder="optional" /></div>
        <div className="sg-field"><label>Choghadiya</label><input className="sg-input" name="choghadiya" defaultValue={ev?.choghadiyaText ?? ''} placeholder="optional" /></div>
        <div className="sg-field" style={{ flex: '1 1 100%' }}><label>Live stream URL</label><input className="sg-input" name="stream" defaultValue={ev?.streamUrl ?? ''} placeholder="https://…" /></div>
      </div>
    </details>
  );
}

function CreateForm({ w }: { w: FamilyEventsWedding }) {
  return (
    <form action={createSideEvent} className="sg-formrow">
      <input type="hidden" name="weddingId" value={w.weddingId} />
      <input type="hidden" name="hostGroupId" value={w.adminGroupId} />
      <input type="hidden" name="tz" value={w.defaultTimezone} />
      <div className="sg-field" style={{ flex: '2 1 220px' }}><label>Event name *</label><input className="sg-input" name="name" required placeholder="e.g. Mehndi" /></div>
      <div className="sg-field"><label>Type</label>
        <select className="sg-select" name="type" defaultValue="mehndi">{EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </div>
      <div className="sg-field"><label>When *</label><input className="sg-input" type="datetime-local" name="wall" required /></div>
      <div className="sg-field"><label>Venue</label>
        <select className="sg-select" name="venue" defaultValue="">
          <option value="">— none —</option>
          {w.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <EnrichmentFields />
      <button type="submit" className="sg-btn sg-btn--primary">Add event</button>
    </form>
  );
}

function EditCard({ w, ev }: { w: FamilyEventsWedding; ev: FamilyEvent }) {
  return (
    <div className="sg-section" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>{ev.functionName ?? 'Event'} <span className="sg-muted" style={{ fontSize: 14, fontWeight: 400 }}>· {whenLabel(ev)}{ev.venueName ? ` · ${ev.venueName}` : ''}</span></h2>
        {ev.cancelled ? <span className="sg-badge is-off">Cancelled</span> : <span className="sg-badge is-on">Scheduled</span>}
      </div>
      <form action={updateSideEvent} className="sg-formrow" style={{ marginTop: 10 }}>
        <input type="hidden" name="weddingId" value={w.weddingId} />
        <input type="hidden" name="instanceId" value={ev.eventInstanceId} />
        <input type="hidden" name="tz" value={ev.tz} />
        <div className="sg-field" style={{ flex: '2 1 200px' }}><label>Name</label><input className="sg-input" name="name" defaultValue={ev.functionName ?? ''} /></div>
        <div className="sg-field"><label>Type</label>
          <select className="sg-select" name="type" defaultValue={ev.functionType ?? 'other'}>{EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        </div>
        <div className="sg-field"><label>When</label><input className="sg-input" type="datetime-local" name="wall" defaultValue={toLocalInput(ev.wallLocal)} /></div>
        <div className="sg-field"><label>Venue</label>
          <select className="sg-select" name="venue" defaultValue={ev.venueId ?? ''}>
            <option value="">— none —</option>
            {w.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <EnrichmentFields ev={ev} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: '1 1 100%' }}>
          <button type="submit" name="cancelled" value="false" className="sg-btn sg-btn--primary">Save changes</button>
          {ev.cancelled
            ? <button type="submit" name="cancelled" value="false" className="sg-btn sg-btn--green sg-btn--sm">Restore</button>
            : <button type="submit" name="cancelled" value="true" className="sg-btn sg-btn--danger sg-btn--sm">Cancel event</button>}
        </div>
      </form>
    </div>
  );
}

export function FamilyEventsWeddingView({ w }: { w: FamilyEventsWedding }) {
  const mine = w.events.filter((e) => e.mine);
  const others = w.events.filter((e) => !e.mine);
  return (
    <>
      <div className="sg-pagehead">
        <h1>Events · {w.title}</h1>
        <p>Create and manage the events {w.adminGroupName ? <strong>{w.adminGroupName}</strong> : 'your side'} is hosting. The rest of the schedule is shown for context; only the event manager or the hosting side can edit those.</p>
      </div>

      <section className="sg-section">
        <h2>Add an event your side is hosting</h2>
        <CreateForm w={w} />
      </section>

      <section className="sg-section">
        <h2>Your side’s events ({mine.length})</h2>
        {mine.length === 0 ? <p className="sg-muted">Nothing yet — add your first event above.</p> : null}
      </section>
      {mine.map((ev) => <EditCard key={ev.eventInstanceId} w={w} ev={ev} />)}

      {others.length ? (
        <section className="sg-section">
          <h2>Rest of the schedule</h2>
          <div className="sg-tablewrap">
            <table className="sg-table">
              <thead><tr><th>Event</th><th>When</th><th>Venue</th><th>Hosted by</th><th></th></tr></thead>
              <tbody>
                {others.map((ev) => (
                  <tr key={ev.eventInstanceId}>
                    <td><strong>{ev.functionName ?? '—'}</strong></td>
                    <td>{whenLabel(ev)}</td>
                    <td>{ev.venueName ?? '—'}</td>
                    <td className="sg-muted">{ev.hostNames.join(', ') || '—'}</td>
                    <td>{ev.cancelled ? <span className="sg-badge is-off">Cancelled</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
