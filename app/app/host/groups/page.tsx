import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getGroupsData, type GroupsWedding, type FamilyGroup, type GroupOperator } from '@/lib/data/groups';
import { createGroup, renameGroup, deleteGroup, assignAdmin, removeOperator } from './actions';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic'; // per-request: reads the owner's session + owner-scoped rows.

const KINDS: { value: string; label: string }[] = [
  { value: 'bride_family', label: "Bride's family" },
  { value: 'groom_family', label: "Groom's family" },
  { value: 'couple', label: 'Couple' },
  { value: 'mutual', label: 'Mutual / both sides' },
  { value: 'custom', label: 'Custom' },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const ROLES: { value: string; label: string }[] = [
  { value: 'host_group_admin', label: 'Family admin' },
  { value: 'co_host', label: 'Co-host (view only)' },
];
const ROLE_LABEL: Record<string, string> = { host_group_admin: 'Family admin', co_host: 'Co-host', wedding_owner: 'Owner' };

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  group: { kind: 'err', text: 'A family needs a name and a type.' },
  admin: { kind: 'err', text: 'Enter a valid email and pick a role.' },
  inuse: { kind: 'err', text: "This family still has admins, households, or expenses attached — remove those first." },
  save: { kind: 'err', text: "Couldn't save — please check the details and try again." },
};

function KindBadge({ kind }: { kind: string }) {
  const cls = kind === 'bride_family' ? 'is-bride' : kind === 'groom_family' ? 'is-groom' : 'is-wait';
  return <span className={`sg-badge ${cls}`}>{KIND_LABEL[kind] ?? kind}</span>;
}

function StatusBadge({ linked }: { linked: boolean }) {
  return linked ? (
    <span className="sg-badge is-on">Active</span>
  ) : (
    <span className="sg-badge is-wait" title="Activates when they first sign in with this email">Invited</span>
  );
}

function OperatorRow({ weddingId, op }: { weddingId: string; op: GroupOperator }) {
  return (
    <tr>
      <td>{op.email ?? '—'}</td>
      <td>{ROLE_LABEL[op.role] ?? op.role}</td>
      <td><StatusBadge linked={op.linked} /></td>
      <td>
        <form action={removeOperator}>
          <input type="hidden" name="weddingId" value={weddingId} />
          <input type="hidden" name="operatorRole" value={op.operatorRoleId} />
          <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Remove</button>
        </form>
      </td>
    </tr>
  );
}

function FamilyCard({ weddingId, g }: { weddingId: string; g: FamilyGroup }) {
  return (
    <section className="sg-section">
      <h2>{g.name} <KindBadge kind={g.kind} /></h2>

      {g.operators.length === 0 ? (
        <p className="sg-muted">No admins yet — add the person who manages this family below.</p>
      ) : (
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead>
              <tr><th>Admin</th><th>Role</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {g.operators.map((op) => <OperatorRow key={op.operatorRoleId} weddingId={weddingId} op={op} />)}
            </tbody>
          </table>
        </div>
      )}

      <form action={assignAdmin} className="sg-formrow">
        <input type="hidden" name="weddingId" value={weddingId} />
        <input type="hidden" name="group" value={g.id} />
        <div className="sg-field">
          <label>Add an admin by email</label>
          <input className="sg-input" type="email" name="email" required placeholder="person@example.com" />
        </div>
        <div className="sg-field">
          <label>Role</label>
          <select className="sg-select" name="role" defaultValue="host_group_admin">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <button type="submit" className="sg-btn sg-btn--primary">Add admin</button>
      </form>

      <details>
        <summary className="sg-muted">Rename / delete</summary>
        <div className="sg-formrow">
          <form action={renameGroup} className="sg-formrow">
            <input type="hidden" name="weddingId" value={weddingId} />
            <input type="hidden" name="group" value={g.id} />
            <div className="sg-field">
              <label>New name</label>
              <input className="sg-input" name="name" defaultValue={g.name} />
            </div>
            <button type="submit" className="sg-btn sg-btn--sm">Rename</button>
          </form>
          <form action={deleteGroup}>
            <input type="hidden" name="weddingId" value={weddingId} />
            <input type="hidden" name="group" value={g.id} />
            <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Delete family</button>
          </form>
        </div>
      </details>
    </section>
  );
}

function CreateFamilyForm({ weddingId, heading }: { weddingId: string; heading: string }) {
  return (
    <section className="sg-section">
      <h2>{heading}</h2>
      <form action={createGroup} className="sg-formrow">
        <input type="hidden" name="weddingId" value={weddingId} />
        <div className="sg-field">
          <label>Type</label>
          <select className="sg-select" name="kind" defaultValue="bride_family">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="sg-field">
          <label>Name *</label>
          <input className="sg-input" name="name" required placeholder="e.g. Sharma family (bride)" />
        </div>
        <button type="submit" className="sg-btn sg-btn--primary">Add family</button>
      </form>
    </section>
  );
}

function WeddingGroups({ w }: { w: GroupsWedding }) {
  return (
    <div>
      <div className="sg-pagehead">
        <h1>Families &amp; admins · {w.title}</h1>
        <p>
          Set up the two sides of the wedding (bride’s and groom’s families) and give each a family admin. Admins can see
          their own family’s finances and scope; the finance screen groups every expense and split by these families.
        </p>
        {w.owners.length > 0 ? (
          <p className="sg-muted">Owner: {w.owners.map((o) => o.email ?? '—').join(', ')}</p>
        ) : null}
      </div>

      {w.groups.length === 0 ? (
        <div className="sg-empty">
          <p>No families yet. Add the bride’s and groom’s families to unlock the two-family model and finance splits.</p>
        </div>
      ) : (
        w.groups.map((g) => <FamilyCard key={g.id} weddingId={w.weddingId} g={g} />)
      )}

      <CreateFamilyForm weddingId={w.weddingId} heading="Add a family" />
    </div>
  );
}

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/groups');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: GroupsWedding[];
  try {
    weddings = await getGroupsData(db);
  } catch {
    return (
      <main className="sg-host">
        <div className="sg-host-shell">
          <HostNav current="groups" />
          <div className="sg-pagehead"><h1>Families &amp; admins</h1></div>
          <div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="groups" />

        {banner ? (
          <div className={"sg-banner " + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div>
        ) : null}

        {weddings.length === 0 ? (
          <>
            <div className="sg-pagehead">
              <h1>Families &amp; admins</h1>
            </div>
            <div className="sg-empty">
              <p className="sg-empty__title">No weddings yet</p>
              <p>
                You’re not set up as an organizer for any wedding yet. Create one first — then you can add the bride’s and
                groom’s families here and assign each a family admin.
              </p>
              <a className="sg-getdir" href="/host/setup">Create a wedding →</a>
            </div>
          </>
        ) : (
          weddings.map((w) => <WeddingGroups key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
