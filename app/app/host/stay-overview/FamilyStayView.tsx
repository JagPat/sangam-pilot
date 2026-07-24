import type { FamilyStayOverview, FamilyHousehold, FamilyGuest, FamilyTravel, FamilyService } from '@/lib/data/family-stay';

// Read-only Stay & Travel oversight for a family admin (their own side) — used by /host/stay-overview and the
// fixture preview. No forms: room and pickup control stays with the event manager; families get visibility
// plus the activity log. Data is already side-scoped by RLS (0016 + 0020).

const ACTION_LABEL: Record<string, string> = {
  room_allocated: 'Room allocated', room_released: 'Room released', room_status: 'Room status', pickup: 'Pickup',
  stay_request: 'Room request', travel: 'Travel', service_added: 'Service added', service_updated: 'Service updated',
  service_request: 'Service requested', service_settled: 'Service settled',
};
const ACTION_CLS: Record<string, string> = {
  room_allocated: 'is-on', room_released: 'is-off', service_settled: 'is-on', pickup: 'is-wait', service_added: 'is-on', service_updated: 'is-wait',
};
const TYPE_LABEL: Record<string, string> = { single: 'Single', double: 'Double', triple: 'Triple', quad: 'Quad', suite: 'Suite' };
const MODE_LABEL: Record<string, string> = { flight: 'Flight', train: 'Train', car: 'Car', bus: 'Bus', self: 'Self' };
const STAY_STATUS: Record<string, string> = { needs_room: 'Room requested', waitlisted: 'Waitlisted', allocated: 'Room assigned', declined: 'Arranging own', cancelled: 'Cancelled' };

function fmtWhen(iso: string): string {
  const s = iso.slice(0, 16);
  return s.length >= 16 ? `${s.slice(0, 10)} · ${s.slice(11, 16)}` : s.slice(0, 10);
}

function travelLine(dir: string, t: FamilyTravel): string {
  const bits = [
    MODE_LABEL[t.mode ?? ''] ?? t.mode ?? null,
    [t.carrier, t.number].filter(Boolean).join(' ') || null,
    t.fromPlace ? `from ${t.fromPlace}` : null,
    t.atInstant ? fmtWhen(t.atInstant) : null,
  ].filter(Boolean);
  return `${dir}: ${bits.join(' · ') || '—'}`;
}

function GuestTravel({ g }: { g: FamilyGuest }) {
  if (!g.arrival && !g.departure) return <div className="sg-muted" style={{ fontSize: 13 }}>{g.guestName ?? 'Guest'} — no travel shared yet</div>;
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
      <strong>{g.guestName ?? 'Guest'}</strong>
      {g.arrival ? <div className="sg-muted" style={{ fontSize: 13 }}>{travelLine('Arrival', g.arrival)}{g.arrival.needsPickup ? ` · pickup ${g.arrival.pickupStatus === 'none' ? 'requested' : g.arrival.pickupStatus}` : ''}</div> : null}
      {g.departure ? <div className="sg-muted" style={{ fontSize: 13 }}>{travelLine('Departure', g.departure)}</div> : null}
    </div>
  );
}

function ServiceLine({ s }: { s: FamilyService }) {
  return (
    <tr>
      <td><strong>{s.name}</strong>{s.who ? <span className="sg-muted" style={{ fontSize: 12 }}> · {s.who}</span> : null}</td>
      <td>×{s.qty}</td>
      <td>{s.chargeLabel ?? <span className="sg-muted">Included</span>}</td>
      <td><span className="sg-badge is-off">{s.status}</span>{s.chargeLabel ? <span className={`sg-badge ${s.settle === 'settled' ? 'is-on' : 'is-wait'}`} style={{ marginLeft: 6 }}>{s.settle === 'settled' ? 'Paid' : s.settle === 'waived' ? 'Waived' : 'Due'}</span> : null}</td>
    </tr>
  );
}

function HouseholdCard({ hh }: { hh: FamilyHousehold }) {
  const req = hh.request;
  return (
    <section className="sg-section">
      <h2>{hh.householdName ?? 'Household'}</h2>

      {hh.rooms.length ? (
        <div style={{ marginBottom: 10 }}>
          {hh.rooms.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong>Room {r.label}</strong>
              <span className="sg-muted" style={{ fontSize: 13 }}>{TYPE_LABEL[r.roomType] ?? r.roomType} · {r.hotelName}</span>
              <span className={`sg-badge ${r.status === 'confirmed' || r.status === 'checked_in' ? 'is-on' : 'is-wait'}`}>{r.status}</span>
              {r.occupants.length ? <span className="sg-muted" style={{ fontSize: 13 }}>· {r.occupants.join(', ')}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="sg-muted" style={{ margin: '0 0 10px' }}>No room assigned yet.</p>
      )}

      {req ? (
        <p style={{ margin: '0 0 10px' }}>
          <span className="sg-badge is-wait">{STAY_STATUS[req.status] ?? req.status}</span>
          {req.arriveOn ? <span className="sg-muted" style={{ fontSize: 13 }}> · {req.arriveOn}{req.departOn ? ` → ${req.departOn}` : ''}</span> : null}
          {req.nights ? <span className="sg-muted" style={{ fontSize: 13 }}> · {req.nights} night{req.nights === 1 ? '' : 's'}</span> : null}
          {req.notes ? <span className="sg-muted" style={{ fontSize: 13 }}> · “{req.notes}”</span> : null}
        </p>
      ) : null}

      <div style={{ marginTop: 4 }}>
        <div className="sg-section__kicker">Travel</div>
        {hh.guests.map((g) => <GuestTravel key={g.guestId} g={g} />)}
      </div>

      {hh.services.length ? (
        <div style={{ marginTop: 12 }}>
          <div className="sg-section__kicker">Services</div>
          <div className="sg-tablewrap">
            <table className="sg-table">
              <thead><tr><th>Service</th><th>Qty</th><th>Charge</th><th>Status</th></tr></thead>
              <tbody>{hh.services.map((s, i) => <ServiceLine key={i} s={s} />)}</tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function FamilyStayView({ o }: { o: FamilyStayOverview }) {
  return (
    <>
      <div className="sg-pagehead">
        <h1>Stay &amp; travel · {o.title}</h1>
        <p>A read-only view of your side — where your guests are staying, how they’re travelling, and the services they’ve asked for. Rooms and pickups are arranged by the event manager; the log below shows what’s been done.</p>
      </div>

      <section className="sg-section">
        <h2>Recent activity</h2>
        {o.activity.length === 0 ? (
          <p className="sg-muted">Nothing logged yet — allocations, pickups, requests and settlements for your side will appear here.</p>
        ) : (
          <div>
            {o.activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                <span className={`sg-badge ${ACTION_CLS[a.action] ?? 'is-off'}`}>{ACTION_LABEL[a.action] ?? a.action}</span>
                <span>{a.summary}</span>
                {a.who ? <span className="sg-muted" style={{ fontSize: 13 }}>· {a.who}</span> : null}
                <span className="sg-muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{fmtWhen(a.when)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {o.households.length === 0 ? (
        <section className="sg-section"><p className="sg-muted">No households on your side yet.</p></section>
      ) : (
        o.households.map((hh) => <HouseholdCard key={hh.householdId} hh={hh} />)
      )}
    </>
  );
}
