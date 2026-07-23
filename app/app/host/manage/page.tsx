import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getManageData, type ManageWedding, type ManageEvent, type ManageGuest } from '@/lib/data/manage';
import { addGuest, updateGuest, inviteGuest, uninviteGuest, removeGuest } from './actions';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic';

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
  const cls = g.bound ? 'is-on' : g.email ? 'is-wait' : 'is-off';
  const label = g.bound ? 'Signed in' : g.email ? 'Invited · not signed in' : 'No email yet';
  return <span className={'sg-badge ' + cls}>{label}</span>;
}

function EventCell({ w, g, ev }: { w: ManageWedding; g: ManageGuest; ev: ManageEvent }) {
  const invited = g.invited[ev.eventInstanceId];
  const locked = g.locked[ev.eventInstanceId];
  if (invited) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <span className="sg-badge is-on">✓ Invited</span>
        {locked ? (
          <span className="sg-badge is-wait" title="Already responded — RSVP preserved">responded 🔒</span>
        ) : (
          <form action={uninviteGuest}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <input type="hidden" name="instanceId" value={ev.eventInstanceId} />
            <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm">Remove</button>
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
      <button type="submit" className="sg-btn sg-btn--green sg-btn--sm">Invite</button>
    </form>
  );
}

function GuestRow({ w, g }: { w: ManageWedding; g: ManageGuest }) {
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <strong>{g.guestName ?? '—'}</strong>
          <span className="sg-muted">{g.email ?? 'no email'}</span>
          <span className="sg-muted">{g.householdName ?? ''}</span>
          <StatusChip g={g} />
        </div>
      </td>
      {w.events.map((ev) => (
        <td key={ev.eventInstanceId} style={{ textAlign: 'center' }}>
          <EventCell w={w} g={g} ev={ev} />
        </td>
      ))}
      <td>
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--maroon)', fontSize: 13 }}>Edit</summary>
          <form action={updateGuest} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <input type="hidden" name="householdId" value={g.householdId} />
            <div className="sg-field"><label>Name</label><input className="sg-input" name="fullName" defaultValue={g.guestName ?? ''} /></div>
            <div className="sg-field"><label>Sign-in email</label><input className="sg-input" name="email" type="email" defaultValue={g.email ?? ''} placeholder="name@example.com" /></div>
            <button type="submit" className="sg-btn sg-btn--primary sg-btn--sm">Save changes</button>
          </form>
          <form action={removeGuest} style={{ marginTop: 10 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Delete guest</button>
          </form>
        </details>
      </td>
    </tr>
  );
}

function WeddingManage({ w }: { w: ManageWedding }) {
  return (
    <>
      <div className="sg-pagehead">
        <h1>Manage · {w.title}</h1>
        <p>
          Add guests with the email their invite will go to, then invite them to events. When a guest signs in with that
          email, they’re linked automatically and see their schedule — no extra step.
        </p>
      </div>

      <section className="sg-section">
        <h2>Add a guest</h2>
        <form action={addGuest} className="sg-formrow">
          <input type="hidden" name="weddingId" value={w.weddingId} />
          <div className="sg-field"><label>Full name *</label><input className="sg-input" name="fullName" required placeholder="e.g. Priya Shah" /></div>
          <div className="sg-field"><label>Sign-in email</label><input className="sg-input" type="email" name="email" placeholder="name@example.com" /></div>
          <div className="sg-field">
            <label>Household</label>
            <select className="sg-select" name="householdId" defaultValue="">
              <option value="">— create new below —</option>
              {w.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="sg-field"><label>…or new household</label><input className="sg-input" name="newHouseholdName" placeholder="e.g. Shah Household" /></div>
          <button type="submit" className="sg-btn sg-btn--primary">Add guest</button>
        </form>
      </section>

      <section className="sg-section">
        <h2>Guests &amp; invitations ({w.guests.length})</h2>
        {w.events.length === 0 ? (
          <div className="sg-banner is-err">This wedding has no events yet. Events are still set up in SQL (manual §5) for now — that screen is the next step after this one.</div>
        ) : null}
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead>
              <tr>
                <th>Guest</th>
                {w.events.map((ev) => (
                  <th key={ev.eventInstanceId} style={{ textAlign: 'center' }}>
                    <div>{ev.functionName ?? '—'}</div>
                    <div className="sg-muted">{fmt(ev.whenInstant, ev.tz)}</div>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {w.guests.length === 0 ? (
                <tr><td colSpan={w.events.length + 2}><span className="sg-muted">No guests yet — add your first above.</span></td></tr>
              ) : (
                w.guests.map((g) => <GuestRow key={g.guestId} w={w} g={g} />)
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
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
      <main className="sg-host">
        <div className="sg-host-shell">
          <HostNav current="manage" />
          <div className="sg-pagehead"><h1>Manage guests</h1></div>
          <div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="manage" />

        {banner ? (
          <div className={'sg-banner ' + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div>
        ) : null}

        {weddings.length === 0 ? (
          <div className="sg-pagehead">
            <h1>Manage guests</h1>
            <p>Your account isn’t set as an organizer (wedding owner) for any wedding yet, so there’s nothing to manage.</p>
          </div>
        ) : (
          weddings.map((w) => <WeddingManage key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
