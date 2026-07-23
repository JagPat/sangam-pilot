import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import {
  getVendorsData,
  VENDOR_CATEGORIES,
  ENGAGEMENT_STATES,
  type VendorsWedding,
  type VendorRow,
  type VendorEngagement,
} from '@/lib/data/vendors';
import { HostNav } from '../HostNav';
import { addVendor, saveEngagement, deleteVendor, deleteEngagement } from './actions';

export const dynamic = 'force-dynamic'; // per-request: reads the owner's session + owner-scoped rows.

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  vendor: { kind: 'err', text: 'A vendor needs a name.' },
  engagement: { kind: 'err', text: 'Pick a vendor for the booking.' },
  save: { kind: 'err', text: "Couldn't save — please try again." },
};

// The booking field set — shared by each vendor's "add a booking" form and the per-engagement edit form.
function BookingFields({ w, e }: { w: VendorsWedding; e?: VendorEngagement }) {
  return (
    <div className="sg-formrow">
      <div className="sg-field">
        <label>Event</label>
        <select className="sg-select" name="eventInstance" defaultValue={e?.eventInstanceId ?? ''}>
          <option value="">— no event yet —</option>
          {w.events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>
      <div className="sg-field"><label>Role</label><input className="sg-input" name="role" defaultValue={e?.roleTitle ?? ''} placeholder="e.g. DJ" /></div>
      <div className="sg-field"><label>Blurb</label><input className="sg-input" name="blurb" defaultValue={e?.blurb ?? ''} placeholder="One line your guests see" /></div>
      <div className="sg-field">
        <label>State</label>
        <select className="sg-select" name="state" defaultValue={e?.state ?? 'shortlisted'}>
          {ENGAGEMENT_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>
      <div className="sg-field"><label>Quote</label><input className="sg-input" type="number" step="0.01" name="amount" defaultValue={e?.quoteAmount ?? ''} placeholder="Quote" /></div>
      <div className="sg-field"><label>Currency</label><input className="sg-input" name="currency" maxLength={3} defaultValue={e?.quoteCurrency ?? ''} placeholder="INR" /></div>
      <div className="sg-field"><label>Notes</label><input className="sg-input" name="notes" defaultValue={e?.notes ?? ''} placeholder="Internal notes" /></div>
    </div>
  );
}

function EngagementRow({ w, v, e }: { w: VendorsWedding; v: VendorRow; e: VendorEngagement }) {
  const stateCls = e.state === 'confirmed' ? 'is-on' : ['declined', 'cancelled'].includes(e.state) ? 'is-off' : 'is-wait';
  return (
    <tr>
      <td>{e.eventName ?? '—'}</td>
      <td>{e.roleTitle ?? '—'}</td>
      <td><span className={`sg-badge ${stateCls}`}>{e.state}</span></td>
      <td>{e.quoteAmount != null ? `${e.quoteCurrency ?? ''} ${e.quoteAmount}` : '—'}</td>
      <td>
        <details>
          <summary className="sg-getdir">Edit</summary>
          <form action={saveEngagement}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="vendorId" value={v.id} />
            <input type="hidden" name="engagementId" value={e.id} />
            <BookingFields w={w} e={e} />
            <div className="sg-formrow" style={{ marginTop: 10 }}>
              <button type="submit" className="sg-btn sg-btn--primary sg-btn--sm">Save booking</button>
            </div>
          </form>
          <form action={deleteEngagement} style={{ marginTop: 10 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="engagementId" value={e.id} />
            <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Remove</button>
          </form>
        </details>
      </td>
    </tr>
  );
}

function VendorSection({ w, v }: { w: VendorsWedding; v: VendorRow }) {
  const fam = v.hostGroupId ? w.families.find((f) => f.id === v.hostGroupId) : undefined;
  const side = fam?.kind === 'bride_family'
    ? { cls: 'is-bride', label: 'Bride’s side' }
    : fam?.kind === 'groom_family'
    ? { cls: 'is-groom', label: 'Groom’s side' }
    : null;
  const contact = [v.contactName, v.email, v.phone].filter(Boolean).join(' · ');

  return (
    <section className="sg-section">
      <h2>
        {v.name} <span className="sg-badge">{v.category}</span>
        {side ? <> <span className={`sg-badge ${side.cls}`}>{side.label}</span></> : null}
      </h2>
      {contact ? <p className="sg-muted">{contact}</p> : null}

      <details>
        <summary className="sg-getdir">Remove</summary>
        <form action={deleteVendor} style={{ marginTop: 10 }}>
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <input type="hidden" name="vendorId" value={v.id} />
          <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Remove vendor</button>
        </form>
      </details>

      {v.engagements.length ? (
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead><tr><th>Event</th><th>Role</th><th>State</th><th>Quote</th><th></th></tr></thead>
            <tbody>
              {v.engagements.map((e) => <EngagementRow key={e.id} w={w} v={v} e={e} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sg-muted">No bookings yet — add one below.</p>
      )}

      <p className="sg-muted" style={{ marginTop: 16, marginBottom: 8 }}>Add a booking</p>
      <form action={saveEngagement}>
        <input type="hidden" name="weddingId" value={w.weddingId} />
        <input type="hidden" name="vendorId" value={v.id} />
        <BookingFields w={w} />
        <div className="sg-formrow" style={{ marginTop: 10 }}>
          <button type="submit" className="sg-btn sg-btn--primary sg-btn--sm">Add booking</button>
        </div>
      </form>
    </section>
  );
}

function AddVendorForm({ w }: { w: VendorsWedding }) {
  return (
    <section className="sg-section">
      <h2>Add a vendor</h2>
      <form action={addVendor} className="sg-formrow">
        <input type="hidden" name="weddingId" value={w.weddingId} />
        <div className="sg-field"><label>Name *</label><input className="sg-input" name="name" required placeholder="e.g. Dhol Baaje" /></div>
        <div className="sg-field">
          <label>Category</label>
          <select className="sg-select" name="category" defaultValue="other">
            {VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="sg-field"><label>Contact</label><input className="sg-input" name="contact" placeholder="Contact name" /></div>
        <div className="sg-field"><label>Email</label><input className="sg-input" type="email" name="email" placeholder="name@example.com" /></div>
        <div className="sg-field"><label>Phone</label><input className="sg-input" name="phone" placeholder="Phone" /></div>
        {w.families.length > 0 ? (
          <div className="sg-field">
            <label>Side</label>
            <select className="sg-select" name="hostGroup" defaultValue="">
              <option value="">— either side —</option>
              {w.families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        ) : null}
        <button type="submit" className="sg-btn sg-btn--primary">Add vendor</button>
      </form>
    </section>
  );
}

function WeddingVendors({ w }: { w: VendorsWedding }) {
  return (
    <div>
      <div className="sg-pagehead">
        <h1>Vendors · {w.title}</h1>
        <p>
          Source and confirm the people who provide the wedding — performers, décor, catering, and more. A booking you
          mark <strong>confirmed</strong> shows up on your guests&rsquo; event cards under &lsquo;Performing&rsquo;.
        </p>
      </div>

      <AddVendorForm w={w} />
      {w.vendors.map((v) => <VendorSection key={v.id} w={w} v={v} />)}
    </div>
  );
}

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/vendors');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: VendorsWedding[];
  try {
    weddings = await getVendorsData(db);
  } catch {
    return (
      <main className="sg-host">
        <div className="sg-host-shell">
          <HostNav current="vendors" />
          <div className="sg-banner is-err">We couldn&rsquo;t load the vendor board right now. Please refresh in a moment.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="vendors" />

        {banner ? (
          <div className={'sg-banner ' + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div>
        ) : null}

        {weddings.length === 0 ? (
          <>
            <div className="sg-pagehead">
              <h1>Vendors</h1>
            </div>
            <div className="sg-empty">
              <p className="sg-empty__title">No weddings yet</p>
              <p>
                You&rsquo;re not set up as an organizer for any wedding yet. Create one first — then you can source
                vendors and track their bookings here.
              </p>
              <a className="sg-getdir" href="/host/setup">Create a wedding →</a>
            </div>
          </>
        ) : (
          weddings.map((w) => <WeddingVendors key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
