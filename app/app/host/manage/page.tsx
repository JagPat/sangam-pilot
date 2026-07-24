import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getManageData, DIETARY_CATEGORIES, JAIN_STRICTNESS, type ManageWedding, type ManageEvent, type ManageGuest } from '@/lib/data/manage';
import { addGuest, updateGuest, saveDietary, inviteGuest, uninviteGuest, removeGuest, setHouseholdSide } from './actions';
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

function sideNameFor(w: ManageWedding, hostGroupId: string | null): string | null {
  return hostGroupId ? (w.sides.find((s) => s.id === hostGroupId)?.name ?? null) : null;
}

function GuestRow({ w, g }: { w: ManageWedding; g: ManageGuest }) {
  const hh = w.households.find((h) => h.id === g.householdId);
  const sideName = sideNameFor(w, hh?.hostGroupId ?? null);
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <strong>{g.guestName ?? '—'}</strong>
          <span className="sg-muted">{g.email ?? 'no email'}</span>
          <span className="sg-muted">{g.householdName ?? ''}{sideName ? ' · ' : ''}{sideName ? <span className="sg-badge is-wait">{sideName}</span> : null}</span>
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
            <label className="sg-check">
              <input type="checkbox" name="showInDirectory" defaultChecked={g.showInDirectory} />
              <span>List in the guest directory</span>
            </label>
            <button type="submit" className="sg-btn sg-btn--primary sg-btn--sm">Save changes</button>
          </form>

          <form action={saveDietary} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
            <input type="hidden" name="weddingId" value={w.weddingId} />
            <input type="hidden" name="guestId" value={g.guestId} />
            <div className="sg-muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase' }}>Dietary &amp; catering</div>
            <div className="sg-field">
              <label>Category</label>
              <select className="sg-select" name="category" defaultValue={g.dietary.category ?? ''}>
                <option value="">— none recorded —</option>
                {DIETARY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="sg-field">
              <label>Jain strictness <span className="sg-muted">(if Jain)</span></label>
              <select className="sg-select" name="jainStrictness" defaultValue={g.dietary.jainStrictness ?? ''}>
                <option value="">— standard / n/a —</option>
                {JAIN_STRICTNESS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </div>
            <label className="sg-check">
              <input type="checkbox" name="noOnionGarlic" defaultChecked={g.dietary.noOnionGarlic} />
              <span>No onion &amp; garlic</span>
            </label>
            <div className="sg-field"><label>Allergies &amp; notes</label><input className="sg-input" name="allergies" defaultValue={g.dietary.allergies ?? ''} placeholder="e.g. peanuts, dairy" /></div>
            <button type="submit" className="sg-btn sg-btn--primary sg-btn--sm">Save dietary</button>
          </form>

          {w.viewerIsOwner ? (
            <form action={removeGuest} style={{ marginTop: 10 }}>
              <input type="hidden" name="weddingId" value={w.weddingId} />
              <input type="hidden" name="guestId" value={g.guestId} />
              <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Delete guest</button>
            </form>
          ) : null}
        </details>
      </td>
    </tr>
  );
}

function WeddingManage({ w }: { w: ManageWedding }) {
  const mySide = !w.viewerIsOwner ? sideNameFor(w, w.viewerGroupId) : null;
  return (
    <>
      <div className="sg-pagehead">
        <h1>{w.viewerIsOwner ? `Manage · ${w.title}` : `${mySide ?? 'Your'} guests · ${w.title}`}</h1>
        <p>
          {w.viewerIsOwner ? (
            <>Add guests with the email their invite will go to, then invite them to events. When a guest signs in with that email, they’re linked automatically and see their schedule — no extra step.</>
          ) : (
            <>You’re managing the <strong>{mySide ?? 'your side’s'}</strong> guest list. Add and edit your side’s guests, invite them to events, and record their dietary needs — you only see and touch your own side.</>
          )}
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
          {w.viewerIsOwner && w.sides.length ? (
            <div className="sg-field">
              <label>Side <span className="sg-muted">(new household)</span></label>
              <select className="sg-select" name="householdSide" defaultValue="">
                <option value="">— unassigned —</option>
                {w.sides.map((sd) => <option key={sd.id} value={sd.id}>{sd.name}</option>)}
              </select>
            </div>
          ) : null}
          <button type="submit" className="sg-btn sg-btn--primary">Add guest</button>
        </form>
        {!w.viewerIsOwner && mySide ? (
          <p className="sg-muted" style={{ marginTop: 8 }}>New households you add are placed on the <strong>{mySide}</strong> side automatically.</p>
        ) : null}
      </section>

      <section className="sg-section">
        <h2>Guests &amp; invitations ({w.guests.length})</h2>
        {w.events.length === 0 ? (
          <div className="sg-banner is-err">This wedding has no events yet. Add venues and events under <strong>Venues &amp; events</strong>, then come back here to invite guests.</div>
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

      {w.viewerIsOwner ? (
        <section className="sg-section">
          <h2>Households &amp; sides</h2>
          {w.sides.length === 0 ? (
            <div className="sg-banner is-err">No families defined yet. Create the bride’s and groom’s families under <strong>Families &amp; admins</strong>, then assign households here so each side’s admin can manage their own guests.</div>
          ) : (
            <>
              <p className="sg-muted">Assign each household to a side. A family admin then manages only the guests on their side.</p>
              <div className="sg-tablewrap">
                <table className="sg-table">
                  <thead><tr><th>Household</th><th>Side</th></tr></thead>
                  <tbody>
                    {w.households.length === 0 ? (
                      <tr><td colSpan={2}><span className="sg-muted">No households yet — add a guest above.</span></td></tr>
                    ) : (
                      w.households.map((h) => (
                        <tr key={h.id}>
                          <td><strong>{h.name}</strong></td>
                          <td>
                            <form action={setHouseholdSide} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input type="hidden" name="weddingId" value={w.weddingId} />
                              <input type="hidden" name="householdId" value={h.id} />
                              <select className="sg-select" name="hostGroupId" defaultValue={h.hostGroupId ?? ''} style={{ maxWidth: 240 }}>
                                <option value="">— unassigned —</option>
                                {w.sides.map((sd) => <option key={sd.id} value={sd.id}>{sd.name}</option>)}
                              </select>
                              <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm">Set</button>
                            </form>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}
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
