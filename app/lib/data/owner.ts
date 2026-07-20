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
