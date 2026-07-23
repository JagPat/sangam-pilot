import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getGroupsData, type GroupsWedding, type FamilyGroup, type GroupOperator } from '@/lib/data/groups';
import { createGroup, renameGroup, deleteGroup, assignAdmin, removeOperator } from './actions';

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

const wrap = { padding: 24, maxWidth: 940, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#111' } as const;
const input = { padding: '7px 9px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, width: '100%', boxSizing: 'border-box' } as const;
const label = { fontSize: 12, color: '#666', display: 'block', marginBottom: 3 } as const;
const btn = { padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc', background: '#fff' } as const;
const btnPrimary = { ...btn, background: '#1d3b5c', color: '#fff', border: '1px solid #1d3b5c' } as const;
const card = { background: '#f7f9fb', border: '1px solid #e3ebf2', borderRadius: 10, padding: 16, marginBottom: 20 } as const;
const pill = { borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' } as const;

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  group: { kind: 'err', text: 'A family needs a name and a type.' },
  admin: { kind: 'err', text: 'Enter a valid email and pick a role.' },
  inuse: { kind: 'err', text: "This family still has admins, households, or expenses attached — remove those first." },
  save: { kind: 'err', text: "Couldn't save — please check the details and try again." },
};

function KindBadge({ kind }: { kind: string }) {
  const bride = kind === 'bride_family';
  const groom = kind === 'groom_family';
  const bg = bride ? '#fdeef3' : groom ? '#eef3fd' : '#f1f3f4';
  const fg = bride ? '#a83b63' : groom ? '#3b5ca8' : '#5f6368';
  return <span style={{ ...pill, background: bg, color: fg }}>{KIND_LABEL[kind] ?? kind}</span>;
}

function StatusBadge({ linked }: { linked: boolean }) {
  return linked
    ? <span style={{ ...pill, background: '#e6f4ea', color: '#137333' }}>Active</span>
    : <span style={{ ...pill, background: '#fef7e0', color: '#8a6d00' }} title="Activates when they first sign in with this email">Invited</span>;
}

function OperatorRow({ weddingId, op }: { weddingId: string; op: GroupOperator }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid #eef', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{op.email ?? '—'}</span>
      <span style={{ ...pill, background: '#eef', color: '#334' }}>{ROLE_LABEL[op.role] ?? op.role}</span>
      <StatusBadge linked={op.linked} />
      <form action={removeOperator} style={{ marginLeft: 'auto' }}>
        <input type="hidden" name="weddingId" value={weddingId} />
        <input type="hidden" name="operatorRole" value={op.operatorRoleId} />
        <button type="submit" style={{ ...btn, color: '#b00020', borderColor: '#e6b4ba', fontSize: 12, padding: '3px 9px' }}>Remove</button>
      </form>
    </div>
  );
}

function FamilyCard({ weddingId, g }: { weddingId: string; g: FamilyGroup }) {
  return (
    <div style={{ ...card, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ fontSize: 16 }}>{g.name}</strong>
        <KindBadge kind={g.kind} />
        <details style={{ marginLeft: 'auto' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#1d3b5c' }}>Rename / delete</summary>
          <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <form action={renameGroup} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <input type="hidden" name="weddingId" value={weddingId} />
              <input type="hidden" name="group" value={g.id} />
              <div><label style={label}>New name</label><input style={input} name="name" defaultValue={g.name} /></div>
              <button type="submit" style={btn}>Rename</button>
            </form>
            <form action={deleteGroup}>
              <input type="hidden" name="weddingId" value={weddingId} />
              <input type="hidden" name="group" value={g.id} />
              <button type="submit" style={{ ...btn, color: '#b00020', borderColor: '#e6b4ba' }}>Delete family</button>
            </form>
          </div>
        </details>
      </div>

      {g.operators.length === 0
        ? <p style={{ color: '#999', fontSize: 13, margin: '0 0 8px' }}>No admins yet — add the person who manages this family below.</p>
        : <div style={{ marginBottom: 8 }}>{g.operators.map((op) => <OperatorRow key={op.operatorRoleId} weddingId={weddingId} op={op} />)}</div>}

      <form action={assignAdmin} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px dashed #dde', paddingTop: 10 }}>
        <input type="hidden" name="weddingId" value={weddingId} />
        <input type="hidden" name="group" value={g.id} />
        <div style={{ flex: '2 1 220px' }}><label style={label}>Add an admin by email</label><input style={input} type="email" name="email" required placeholder="person@example.com" /></div>
        <div style={{ flex: '1 1 150px' }}>
          <label style={label}>Role</label>
          <select style={input as React.CSSProperties} name="role" defaultValue="host_group_admin">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <button type="submit" style={btnPrimary}>Add admin</button>
      </form>
    </div>
  );
}

function CreateFamilyForm({ weddingId, heading }: { weddingId: string; heading: string }) {
  return (
    <form action={createGroup} style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <input type="hidden" name="weddingId" value={weddingId} />
      <div style={{ flex: '1 1 100%', fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{heading}</div>
      <div style={{ flex: '1 1 180px' }}>
        <label style={label}>Type</label>
        <select style={input as React.CSSProperties} name="kind" defaultValue="bride_family">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div style={{ flex: '2 1 220px' }}><label style={label}>Name *</label><input style={input} name="name" required placeholder="e.g. Sharma family (bride)" /></div>
      <button type="submit" style={btnPrimary}>Add family</button>
    </form>
  );
}

function WeddingGroups({ w }: { w: GroupsWedding }) {
  return (
    <div style={{ marginBottom: 44 }}>
      <h1 style={{ margin: '0 0 2px' }}>Families &amp; admins · {w.title}</h1>
      <p style={{ color: '#666', fontSize: 14, margin: '0 0 6px', maxWidth: 680 }}>
        Set up the two sides of the wedding (bride’s and groom’s families) and give each a family admin. Admins can see
        their own family’s finances and scope; the finance screen groups every expense and split by these families.
      </p>
      {w.owners.length > 0 ? (
        <p style={{ color: '#777', fontSize: 13, margin: '0 0 16px' }}>
          Owner: {w.owners.map((o) => o.email ?? '—').join(', ')}
        </p>
      ) : null}

      {w.groups.length === 0 ? (
        <div style={{ ...card }}>
          <p style={{ margin: '0 0 6px', color: '#555' }}>No families yet. Add the bride’s and groom’s families to unlock the two-family model and finance splits.</p>
        </div>
      ) : (
        w.groups.map((g) => <FamilyCard key={g.id} weddingId={w.weddingId} g={g} />)
      )}

      <CreateFamilyForm weddingId={w.weddingId} heading="Add a family" />
    </div>
  );
}

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireVerifiedUser('/host/groups');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: GroupsWedding[];
  try {
    weddings = await getGroupsData(db);
  } catch {
    return (
      <main style={wrap}>
        <h1>Families &amp; admins</h1>
        <p style={{ color: '#b00020' }}>We couldn’t load this page right now. Please refresh in a moment.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {weddings.length > 0 ? <Link href="/host" style={{ fontSize: 13, color: '#1d3b5c' }}>← Dashboard</Link> : null}
          {weddings.length > 0 ? <Link href="/host/setup" style={{ fontSize: 13, color: '#1d3b5c' }}>Venues &amp; events</Link> : null}
          {weddings.length > 0 ? <Link href="/host/finance" style={{ fontSize: 13, color: '#1d3b5c' }}>Finance</Link> : null}
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
          <h1 style={{ marginTop: 0 }}>Families &amp; admins</h1>
          <p style={{ color: '#555', maxWidth: 640 }}>
            You’re not set up as an organizer for any wedding yet. Create one first — then you can add the bride’s and
            groom’s families here and assign each a family admin.
          </p>
          <Link href="/host/setup" style={{ ...btnPrimary, display: 'inline-block', marginTop: 8, textDecoration: 'none' }}>Create a wedding →</Link>
        </div>
      ) : (
        weddings.map((w) => <WeddingGroups key={w.weddingId} w={w} />)
      )}
    </main>
  );
}
