import type { AppSupabaseClient } from '../supabase/clients';

// The wedding ids the signed-in account owns (operator_role = 'wedding_owner'). Derived from the account id
// of the VERIFIED session (app.current_account_id) + operator_role, so it is correct even for a wedding
// that has no invitations yet — unlike inferring ownership from the aggregate counts view, which is empty
// until the first invitation exists. RLS still applies: operator_role rows are only visible to members.
export async function ownedWeddingIds(db: AppSupabaseClient): Promise<string[]> {
  const app = db.schema('app');

  const { data: accId, error: eAcc } = await app.rpc('current_account_id');
  if (eAcc) throw eAcc;
  const accountId = accId as unknown as string | null;
  if (!accountId) return [];

  const { data, error } = await app
    .from('operator_role')
    .select('wedding_id')
    .eq('role', 'wedding_owner')
    .eq('account_id', accountId);
  if (error) throw error;

  return [...new Set((data ?? []).map((r) => r.wedding_id))];
}

// Broader operator context: every wedding the signed-in account can manage, and IN WHAT CAPACITY — the
// wedding owner (full), or a family admin scoped to one side (host_group). Used by the guest screen so a
// bride/groom-side admin lands on a scoped view (RLS enforces the actual row-level scope; this only drives
// which wedding ids to load and how the UI behaves).
export type OperatorContext = {
  ids: string[]; // wedding ids where I hold any operator role
  byWedding: Record<string, { isOwner: boolean; adminGroupId: string | null }>;
};

export async function getOperatorContext(db: AppSupabaseClient): Promise<OperatorContext> {
  const app = db.schema('app');
  const { data: accId, error: eAcc } = await app.rpc('current_account_id');
  const accountId = (accId as unknown as string | null) ?? null;
  if (eAcc || !accountId) return { ids: [], byWedding: {} };

  const { data, error } = await app.from('operator_role').select('wedding_id, role, host_group_id').eq('account_id', accountId);
  if (error) throw error;

  const byWedding: Record<string, { isOwner: boolean; adminGroupId: string | null }> = {};
  for (const r of data ?? []) {
    const cur = byWedding[r.wedding_id] ?? { isOwner: false, adminGroupId: null };
    if (r.role === 'wedding_owner') cur.isOwner = true;
    else if ((r.role === 'host_group_admin' || r.role === 'co_host') && r.host_group_id) cur.adminGroupId = cur.adminGroupId ?? r.host_group_id;
    byWedding[r.wedding_id] = cur;
  }
  return { ids: Object.keys(byWedding), byWedding };
}
