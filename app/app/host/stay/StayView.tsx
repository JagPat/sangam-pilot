import { ROOM_TYPES, type StayWedding, type StayRoom } from '@/lib/data/stay';
import { addHotel, addRooms, allocateHousehold, setAllocationStatus, addOccupant, removeOccupant } from './actions';

// Presentational console for Stay & Travel (used by /host/stay and the fixture preview). Server-action
// forms are wired here; the route page supplies the data.

const TYPE_LABEL: Record<string, string> = Object.fromEntries(ROOM_TYPES.map((t) => [t.value, t.label]));
const STATUS_LABEL: Record<string, string> = { held: 'Held', confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out' };

function OccupancyTiles({ w }: { w: StayWedding }) {
  return (
    <>
      <div className="sg-tiles">
        <div className="sg-tile"><div className="sg-tile__num">{w.totals.rooms}</div><div className="sg-tile__label">Rooms</div></div>
        <div className="sg-tile"><div className="sg-tile__num">{w.totals.occupied}</div><div className="sg-tile__label">Occupied</div></div>
        <div className="sg-tile"><div className="sg-tile__num">{w.totals.free}</div><div className="sg-tile__label">Free</div></div>
        <div className="sg-tile"><div className="sg-tile__num">{w.totals.rooms ? Math.round((w.totals.occupied / w.totals.rooms) * 100) : 0}%</div><div className="sg-tile__label">Filled</div></div>
      </div>
      {w.summary.length ? (
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead><tr><th>Room type</th><th>Total</th><th>Occupied</th><th>Free</th></tr></thead>
            <tbody>
              {w.summary.map((s) => (
                <tr key={s.roomType}><td><strong>{TYPE_LABEL[s.roomType] ?? s.roomType}</strong></td><td>{s.total}</td><td>{s.occupied}</td><td>{s.free}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function RoomCard({ w, room }: { w: StayWedding; room: StayRoom }) {
  const a = room.allocation;
  const seated = new Set((a?.occupants ?? []).map((o) => o.guestId));
  const household = a ? w.households.find((h) => h.id === a.householdId) : null;
  const unseated = household ? household.guests.filter((g) => !seated.has(g.guestId)) : [];
  const unallocated = w.households.filter((h) => !h.allocated);

  return (
    <div className="sg-section" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>
          {room.label} <span className="sg-muted" style={{ fontSize: 14, fontWeight: 400 }}>· {TYPE_LABEL[room.roomType] ?? room.roomType} · {room.capacity} bed{room.capacity > 1 ? 's' : ''} · {room.hotelName}</span>
        </h2>
        {room.outOfService ? <span className="sg-badge is-off">Out of service</span>
          : a ? <span className="sg-badge is-on">{STATUS_LABEL[a.status] ?? a.status}</span>
          : <span className="sg-badge is-wait">Free</span>}
      </div>

      {a ? (
        <div style={{ marginTop: 12 }}>
          <div><strong>{a.householdName ?? '—'}</strong>{a.checkIn ? <span className="sg-muted"> · {a.checkIn}{a.checkOut ? ` → ${a.checkOut}` : ''}</span> : null}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {a.occupants.length === 0 ? <span className="sg-muted">No roommates seated.</span> : a.occupants.map((o) => (
              <span key={o.guestId} className="sg-chip">
                {o.guestName ?? '—'}
                <form action={removeOccupant} style={{ display: 'inline' }}>
                  <input type="hidden" name="weddingId" value={w.weddingId} />
                  <input type="hidden" name="allocationId" value={a.allocationId} />
                  <input type="hidden" name="guestId" value={o.guestId} />
                  <button type="submit" title="Remove" style={{ border: 0, background: 'transparent', color: 'var(--clay)', cursor: 'pointer', fontWeight: 700, marginLeft: 4 }}>×</button>
                </form>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            {unseated.length && a.occupants.length < room.capacity ? (
              <form action={addOccupant} style={{ display: 'flex', gap: 6 }}>
                <input type="hidden" name="weddingId" value={w.weddingId} />
                <input type="hidden" name="allocationId" value={a.allocationId} />
                <select className="sg-select" name="guestId" defaultValue="" style={{ maxWidth: 200 }}>
                  <option value="" disabled>Add roommate…</option>
                  {unseated.map((g) => <option key={g.guestId} value={g.guestId}>{g.guestName ?? '—'}</option>)}
                </select>
                <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm">Add</button>
              </form>
            ) : null}
            {a.status === 'held' ? (
              <form action={setAllocationStatus}>
                <input type="hidden" name="weddingId" value={w.weddingId} /><input type="hidden" name="allocationId" value={a.allocationId} /><input type="hidden" name="status" value="confirmed" />
                <button type="submit" className="sg-btn sg-btn--green sg-btn--sm">Confirm</button>
              </form>
            ) : null}
            <form action={setAllocationStatus}>
              <input type="hidden" name="weddingId" value={w.weddingId} /><input type="hidden" name="allocationId" value={a.allocationId} /><input type="hidden" name="status" value="cancelled" />
              <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Release room</button>
            </form>
          </div>
        </div>
      ) : (
        <form action={allocateHousehold} className="sg-formrow" style={{ marginTop: 12 }}>
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <input type="hidden" name="roomId" value={room.roomId} />
          <div className="sg-field">
            <label>Allocate household</label>
            <select className="sg-select" name="householdId" defaultValue="" required>
              <option value="" disabled>Choose a household…</option>
              {unallocated.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.guests.length})</option>)}
            </select>
          </div>
          <div className="sg-field"><label>Check‑in</label><input className="sg-input" type="date" name="checkIn" /></div>
          <div className="sg-field"><label>Check‑out</label><input className="sg-input" type="date" name="checkOut" /></div>
          <button type="submit" className="sg-btn sg-btn--primary">Allocate</button>
        </form>
      )}
    </div>
  );
}

export function StayWeddingView({ w }: { w: StayWedding }) {
  return (
    <>
      <div className="sg-pagehead">
        <h1>Stay &amp; Travel · {w.title}</h1>
        <p>Set up the hotel’s room block, then allocate households to rooms and seat their roommates. Occupancy updates live; releasing a room frees it for the next household.</p>
      </div>

      <section className="sg-section">
        <h2>Occupancy</h2>
        {w.totals.rooms === 0 ? <p className="sg-muted">No rooms yet — add a hotel and its rooms below.</p> : <OccupancyTiles w={w} />}
      </section>

      <section className="sg-section">
        <h2>Hotels &amp; rooms</h2>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, margin: '4px 0 8px' }}>Add a hotel</h3>
        <form action={addHotel} className="sg-formrow">
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <div className="sg-field"><label>Hotel name *</label><input className="sg-input" name="name" required placeholder="e.g. The Grand Bhagwati" /></div>
          <div className="sg-field"><label>Address</label><input className="sg-input" name="address" placeholder="optional" /></div>
          <button type="submit" className="sg-btn sg-btn--primary">Add hotel</button>
        </form>

        {w.hotels.length ? (
          <>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, margin: '18px 0 8px' }}>Bulk‑add rooms</h3>
            <form action={addRooms} className="sg-formrow">
              <input type="hidden" name="weddingId" value={w.weddingId} />
              <div className="sg-field"><label>Hotel</label>
                <select className="sg-select" name="hotelId" defaultValue={w.hotels[0].id}>{w.hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
              </div>
              <div className="sg-field"><label>Type</label>
                <select className="sg-select" name="roomType" defaultValue="double">{ROOM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
              </div>
              <div className="sg-field"><label>Beds</label><input className="sg-input" name="capacity" type="number" min={1} max={12} defaultValue={2} style={{ maxWidth: 90 }} /></div>
              <div className="sg-field"><label>How many</label><input className="sg-input" name="count" type="number" min={1} max={500} defaultValue={1} style={{ maxWidth: 90 }} /></div>
              <div className="sg-field"><label>First room #</label><input className="sg-input" name="startLabel" placeholder="e.g. 201" style={{ maxWidth: 110 }} /></div>
              <button type="submit" className="sg-btn sg-btn--primary">Add rooms</button>
            </form>
            <p className="sg-muted" style={{ marginTop: 8, fontSize: 13 }}>A numeric “first room #” counts up (201, 202, 203…). Leave it blank to number them 1, 2, 3…</p>
          </>
        ) : null}
      </section>

      <section className="sg-section">
        <h2>Rooming list ({w.rooms.length} room{w.rooms.length === 1 ? '' : 's'})</h2>
        <p className="sg-muted">Allocating a household seats its guests automatically, up to the room’s capacity — adjust roommates per room below.</p>
      </section>
      {w.rooms.map((room) => <RoomCard key={room.roomId} w={w} room={room} />)}
    </>
  );
}
