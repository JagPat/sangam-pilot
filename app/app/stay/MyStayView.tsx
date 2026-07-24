import {
  TRAVEL_MODES,
  type MyStayData,
  type MyStayHousehold,
  type MyStayGuest,
  type MyStayRoom,
  type MyTravel,
} from '@/lib/data/mystay';
import { setStayRequest, saveTravel } from './actions';

// Presentational "Your stay & travel" for the signed-in guest (used by /stay and the fixture preview).
// The loader (lib/data/mystay.ts) already limits everything to what this account can act for; the forms post
// to the guest actions in ./actions.ts, and RLS (0018) is the real guard. A household head acting for their
// family sees one block per person they can act for.

const TYPE_LABEL: Record<string, string> = { single: 'Single', double: 'Double', triple: 'Triple', quad: 'Quad', suite: 'Suite' };
const STAY_STATUS: Record<string, { label: string; cls: string }> = {
  needs_room: { label: 'Room requested', cls: 'is-wait' },
  waitlisted: { label: 'On the waitlist', cls: 'is-wait' },
  allocated: { label: 'Room assigned', cls: 'is-on' },
  declined: { label: 'Arranging own stay', cls: 'is-off' },
  cancelled: { label: 'Cancelled', cls: 'is-off' },
};
const PICKUP_STATUS: Record<string, { label: string; cls: string }> = {
  requested: { label: 'Pickup requested', cls: 'is-wait' },
  assigned: { label: 'Pickup arranged', cls: 'is-on' },
  done: { label: 'Picked up', cls: 'is-on' },
};

function RoomCard({ r }: { r: MyStayRoom }) {
  const others = r.roommates.filter(Boolean);
  return (
    <div className="sg-section" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>
          Room {r.roomLabel}{' '}
          <span className="sg-muted" style={{ fontSize: 14, fontWeight: 400 }}>
            · {TYPE_LABEL[r.roomType] ?? r.roomType} · {r.hotelName}
          </span>
        </h2>
        <span className={`sg-badge ${r.status === 'confirmed' || r.status === 'checked_in' ? 'is-on' : 'is-wait'}`}>
          {r.status === 'checked_in' ? 'Checked in' : r.status === 'confirmed' ? 'Confirmed' : 'Held for you'}
        </span>
      </div>
      {r.checkIn ? (
        <p className="sg-muted" style={{ margin: '8px 0 0' }}>
          {r.checkIn}{r.checkOut ? ` → ${r.checkOut}` : ''}
        </p>
      ) : null}
      {others.length ? (
        <div className="sg-chips">
          {others.map((name, i) => (
            <span key={`${name}-${i}`} className="sg-chip">{name}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StayRequestForm({ hh }: { hh: MyStayHousehold }) {
  const req = hh.request;
  const cur = req?.status ?? '';
  const choice = cur === 'declined' ? 'declined' : 'needs_room';
  const badge = req ? STAY_STATUS[req.status] : null;

  return (
    <section className="sg-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>A room in the hotel block</h2>
        {badge ? <span className={`sg-badge ${badge.cls}`}>{badge.label}</span> : null}
      </div>
      <p className="sg-muted" style={{ margin: '6px 0 0' }}>
        Let your hosts know whether you’d like a room set aside. They assign the actual room — you’ll see it above once it’s ready.
      </p>
      <form action={setStayRequest} className="sg-formrow" style={{ marginTop: 12 }}>
        <input type="hidden" name="weddingId" value={hh.weddingId} />
        <input type="hidden" name="householdId" value={hh.householdId} />
        <div className="sg-field">
          <label>Do you need a room?</label>
          <select className="sg-select" name="status" defaultValue={choice}>
            <option value="needs_room">Yes — please set one aside</option>
            <option value="declined">No — we’ll arrange our own</option>
          </select>
        </div>
        <div className="sg-field"><label>Nights</label><input className="sg-input" type="number" name="nights" min={0} max={60} defaultValue={req?.nights ?? ''} style={{ maxWidth: 90 }} /></div>
        <div className="sg-field"><label>Arrive</label><input className="sg-input" type="date" name="arriveOn" defaultValue={req?.arriveOn ?? ''} /></div>
        <div className="sg-field"><label>Depart</label><input className="sg-input" type="date" name="departOn" defaultValue={req?.departOn ?? ''} /></div>
        <div className="sg-field" style={{ flex: '1 1 100%' }}>
          <label>Anything we should know?</label>
          <input className="sg-input" name="notes" defaultValue={req?.notes ?? ''} placeholder="e.g. ground floor, cot for a baby, arriving late" />
        </div>
        <button type="submit" className="sg-btn sg-btn--primary">Save request</button>
      </form>
    </section>
  );
}

function TravelForm({ weddingId, guest, direction }: { weddingId: string; guest: MyStayGuest; direction: 'arrival' | 'departure' }) {
  const t: MyTravel | null = direction === 'arrival' ? guest.arrival : guest.departure;
  const when = t?.atInstant ? t.atInstant.slice(0, 16) : '';
  const pickup = t?.pickupStatus && t.pickupStatus !== 'none' ? PICKUP_STATUS[t.pickupStatus] : null;
  const isArr = direction === 'arrival';

  return (
    <form action={saveTravel} className="sg-formrow" style={{ marginTop: 4 }}>
      <input type="hidden" name="weddingId" value={weddingId} />
      <input type="hidden" name="guestId" value={guest.guestId} />
      <input type="hidden" name="direction" value={direction} />
      <div className="sg-field" style={{ flex: '1 1 100%' }}>
        <div className="sg-section__kicker" style={{ marginBottom: 8 }}>
          {isArr ? 'Arrival' : 'Departure'}
          {pickup ? <span className={`sg-badge ${pickup.cls}`} style={{ marginLeft: 8 }}>{pickup.label}</span> : null}
        </div>
      </div>
      <div className="sg-field"><label>How</label>
        <select className="sg-select" name="mode" defaultValue={t?.mode ?? ''}>
          <option value="">—</option>
          {TRAVEL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="sg-field"><label>{isArr ? 'Arriving at' : 'Leaving at'}</label><input className="sg-input" type="datetime-local" name="atInstant" defaultValue={when} /></div>
      <div className="sg-field"><label>Airline / train</label><input className="sg-input" name="carrier" defaultValue={t?.carrier ?? ''} placeholder="e.g. IndiGo" /></div>
      <div className="sg-field"><label>Flight / train no.</label><input className="sg-input" name="number" defaultValue={t?.number ?? ''} placeholder="e.g. 6E-203" style={{ maxWidth: 150 }} /></div>
      <div className="sg-field"><label>{isArr ? 'Coming from' : 'Going to'}</label><input className="sg-input" name="fromPlace" defaultValue={t?.fromPlace ?? ''} placeholder="City / airport" /></div>
      <div className="sg-field"><label>Transport</label>
        <select className="sg-select" name="arrangedBy" defaultValue={t?.arrangedBy ?? 'self'}>
          <option value="self">I’ll arrange my own</option>
          <option value="host">Please arrange pickup</option>
        </select>
      </div>
      <div className="sg-field" style={{ justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" name="needsPickup" defaultChecked={t?.needsPickup ?? false} />
          Need a pickup
        </label>
      </div>
      <div className="sg-field" style={{ flex: '1 1 100%' }}>
        <label>Luggage note</label>
        <input className="sg-input" name="luggageNote" defaultValue={t?.luggageNote ?? ''} placeholder="e.g. 2 large suitcases, a stroller" />
      </div>
      <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm">Save {isArr ? 'arrival' : 'departure'}</button>
    </form>
  );
}

function GuestTravel({ weddingId, guest }: { weddingId: string; guest: MyStayGuest }) {
  return (
    <section className="sg-section">
      <h2 style={{ marginBottom: 4 }}>{guest.guestName ?? 'Your'} travel</h2>
      <p className="sg-muted" style={{ margin: '0 0 10px' }}>
        Share how you’re getting in and out so your hosts can plan pickups and check-in.
      </p>
      <TravelForm weddingId={weddingId} guest={guest} direction="arrival" />
      <div style={{ height: 1, background: 'var(--line)', margin: '18px 0' }} />
      <TravelForm weddingId={weddingId} guest={guest} direction="departure" />
    </section>
  );
}

function HouseholdBlock({ hh }: { hh: MyStayHousehold }) {
  return (
    <>
      <StayRequestForm hh={hh} />
      {hh.guests.map((g) => (
        <GuestTravel key={g.guestId} weddingId={hh.weddingId} guest={g} />
      ))}
    </>
  );
}

export function MyStayView({ data }: { data: MyStayData }) {
  if (data.households.length === 0) {
    return (
      <div className="sg-empty">
        <div className="sg-empty__title">Nothing to arrange yet</div>
        <p style={{ margin: 0 }}>
          Once you’re on a guest list, your stay and travel details will appear here.
        </p>
      </div>
    );
  }
  return (
    <>
      {data.rooms.length ? (
        <section className="sg-section" style={{ background: 'transparent', border: 0, boxShadow: 'none', padding: 0, marginBottom: 8 }}>
          <div className="sg-section__kicker">Where you’re staying</div>
        </section>
      ) : null}
      {data.rooms.map((r, i) => <RoomCard key={`${r.roomLabel}-${i}`} r={r} />)}
      {data.households.map((hh) => <HouseholdBlock key={hh.householdId} hh={hh} />)}
    </>
  );
}
