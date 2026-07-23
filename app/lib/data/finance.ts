import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the owner-facing finance screen (/host/finance). Scoped to weddings the signed-in account
// owns. Expenses/allocations are read under RLS (owner sees all of their wedding); the net position comes
// from the owner-gated aggregate view. READ ONLY; writes go through the owner RPCs in actions.ts.

export type FinanceGroup = { id: string; name: string; kind: string };
export type FinanceAllocation = { groupId: string; groupName: string | null; amount: number };
export type FinanceExpense = {
  id: string; description: string; category: string; amount: number; currency: string;
  paidAt: string; paidByGroupId: string; paidByGroupName: string | null; note: string | null;
  allocations: FinanceAllocation[];
};
export type NetRow = { groupId: string; groupName: string | null; paid: number; allocated: number; net: number };
export type FinanceWedding = {
  weddingId: string; title: string;
  groups: FinanceGroup[];
  expenses: FinanceExpense[];
  netByCurrency: { currency: string; rows: NetRow[] }[];
};

export async function getFinanceData(db: AppSupabaseClient): Promise<FinanceWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, groups, exps, allocs, nets] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('host_group').select('id, wedding_id, kind, name').in('wedding_id', weddingIds),
    app.from('finance_expense').select('id, wedding_id, description, category, amount, currency_code, paid_at, paid_by_host_group_id, note').in('wedding_id', weddingIds),
    app.from('finance_expense_allocation').select('wedding_id, expense_id, responsible_host_group_id, allocation_amount').in('wedding_id', weddingIds),
    app.from('finance_net_position').select('wedding_id, host_group_id, currency_code, paid_amount, allocated_amount, net_position').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, groups, exps, allocs, nets]) if (r.error) throw r.error;

  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));

  return (weds.data ?? []).map((w) => {
    const wGroups: FinanceGroup[] = (groups.data ?? [])
      .filter((g) => g.wedding_id === w.id)
      .map((g) => ({ id: g.id, name: g.name, kind: g.kind }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const wAllocs = (allocs.data ?? []).filter((a) => a.wedding_id === w.id);
    const expenses: FinanceExpense[] = (exps.data ?? [])
      .filter((e) => e.wedding_id === w.id)
      .map((e) => ({
        id: e.id, description: e.description, category: e.category, amount: Number(e.amount), currency: e.currency_code,
        paidAt: e.paid_at, paidByGroupId: e.paid_by_host_group_id, paidByGroupName: groupName.get(e.paid_by_host_group_id) ?? null,
        note: e.note ?? null,
        allocations: wAllocs.filter((a) => a.expense_id === e.id).map((a) => ({
          groupId: a.responsible_host_group_id, groupName: groupName.get(a.responsible_host_group_id) ?? null, amount: Number(a.allocation_amount),
        })),
      }))
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

    const wNets = (nets.data ?? []).filter((n) => n.wedding_id === w.id);
    const currencies = [...new Set(wNets.map((n) => n.currency_code))].sort();
    const netByCurrency = currencies.map((cur) => ({
      currency: cur,
      rows: wNets.filter((n) => n.currency_code === cur).map((n) => ({
        groupId: n.host_group_id, groupName: groupName.get(n.host_group_id) ?? null,
        paid: Number(n.paid_amount), allocated: Number(n.allocated_amount), net: Number(n.net_position),
      })).sort((a, b) => (a.groupName ?? '').localeCompare(b.groupName ?? '')),
    }));

    return { weddingId: w.id, title: w.title, groups: wGroups, expenses, netByCurrency };
  });
}
