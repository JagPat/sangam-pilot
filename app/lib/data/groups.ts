import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the families & admins screen (/host/groups): each owned wedding's host_groups (bride/groom
// families, couple, etc.) plus the operators attached to them, with emails. host_group rows are readable by
// any member via RLS, but account.email is self-only — so operators+emails come from the owner-gated
// owner_list_operators RPC. READ ONLY; mutations go through app/host/groups/actions.ts.

export type GroupOperator = {
  operatorRoleId: string;
  email: string | null;
  role: string;          // 'host_group_admin' | 'co_host' | 'wedding_owner'
  linked: boolean;       // has this person actually signed in yet (account bound to an auth user)?
};

export type FamilyGroup = {
  id: string;
  kind: string;          // bride_family | groom_family | couple | mutual | custom
  name: string;
  operators: GroupOperator[];
};

export type GroupsWedding = {
  weddingId: string;
  title: string;
  owners: GroupOperator[];   // wedding_owner rows (host_group_id null)
  groups: FamilyGroup[];
};

export async function getGroupsData(db: AppSupabaseClient): Promise<GroupsWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, groups] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('host_group').select('id, wedding_id, kind, name').in('wedding_id', weddingIds),
  ]);
  if (weds.error) throw weds.error;
  if (groups.error) throw groups.error;

  // Operators (with emails) per wedding — owner-gated RPC, one call per owned wedding.
  const opsByWedding = new Map<string, GroupOperator[]>();
  await Promise.all(
    weddingIds.map(async (wid) => {
      const { data, error } = await app.rpc('owner_list_operators', { p_wedding: wid });
      if (error) throw error;
      opsByWedding.set(
        wid,
        (data ?? []).map((o) => ({ operatorRoleId: o.id, email: o.email, role: o.role, linked: o.linked, hostGroupId: o.host_group_id })) as (GroupOperator & { hostGroupId: string | null })[],
      );
    }),
  );

  return (weds.data ?? []).map((w) => {
    const ops = (opsByWedding.get(w.id) ?? []) as (GroupOperator & { hostGroupId: string | null })[];
    const groupList = (groups.data ?? [])
      .filter((g) => g.wedding_id === w.id)
      .map((g) => ({
        id: g.id,
        kind: g.kind,
        name: g.name,
        operators: ops
          .filter((o) => o.hostGroupId === g.id)
          .map(({ operatorRoleId, email, role, linked }) => ({ operatorRoleId, email, role, linked })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const owners = ops
      .filter((o) => o.hostGroupId === null)
      .map(({ operatorRoleId, email, role, linked }) => ({ operatorRoleId, email, role, linked }));
    return { weddingId: w.id, title: w.title, owners, groups: groupList };
  });
}
