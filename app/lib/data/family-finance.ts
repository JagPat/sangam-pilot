import type { AppSupabaseClient } from '../supabase/clients';
import { getOperatorContext } from './owner';

// Read model for the family-admin "Finance & vendors" screen (/host/budget). Everything is READ-ONLY and
// already side-scoped by RLS: 0011's finance policies expose the expenses this side paid or is responsible
// for + the net-position split (any host-group admin is a finance viewer), and 0022 exposes the vendors this
// side sources + their engagements. The owner still owns every write.

export const VENDOR_CATEGORY: Record<string, string> = {
  music: 'Music', dj: 'DJ', band: 'Band', mc: 'MC', hair: 'Hair', makeup: 'Make-up', decor: 'Décor',
  florist: 'Florist', catering: 'Catering', photo: 'Photography', transport: 'Transport', pandit: 'Pandit', other: 'Other',
};
export const ENGAGEMENT_STATE: Record<string, { label: string; cls: string }> = {
  shortlisted: { label: 'Shortlisted', cls: 'is-off' },
  inquired: { label: 'Inquired', cls: 'is-wait' },
  quoted: { label: 'Quoted', cls: 'is-wait' },
  confirmed: { label: 'Confirmed', cls: 'is-on' },
  declined: { label: 'Declined', cls: 'is-off' },
  cancelled: { label: 'Cancelled', cls: 'is-off' },
};

export function formatAmount(amount: number | string | null, currency = 'INR'): string {
  const n = Number(amount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (currency === 'INR' ? '₹' : `${currency} `) + n;
}

export type NetRow = { groupName: string; currency: string; paid: number; allocated: number; net: number; mine: boolean };
export type FamilyExpense = { id: string; description: string; category: string; amount: number; currency: string; paidAt: string; paidByName: string | null; note: string | null };
export type FamilyEngagement = { roleTitle: string | null; state: string; quoteAmount: number | null; quoteCurrency: string | null; eventName: string | null };
export type FamilyVendor = { id: string; name: string; category: string; contactName: string | null; phone: string | null; email: string | null; engagements: FamilyEngagement[] };
export type FamilyBudgetWedding = {
  weddingId: string; title: string; adminGroupId: string; adminGroupName: string | null;
  net: NetRow[]; expenses: FamilyExpense[]; vendors: FamilyVendor[];
};

export async function getFamilyBudget(db: AppSupabaseClient): Promise<FamilyBudgetWedding[]> {
  const ctx = await getOperatorContext(db);
  const weddingIds = ctx.ids.filter((id) => ctx.byWedding[id]?.adminGroupId);
  if (weddingIds.length === 0) return [];

  const app = db.schema('app');
  const [weds, groups, net, expenses, vendors, engs, insts, funcs] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('host_group').select('id, wedding_id, name').in('wedding_id', weddingIds),
    app.from('finance_net_position').select('wedding_id, host_group_id, currency_code, paid_amount, allocated_amount, net_position').in('wedding_id', weddingIds),
    app.from('finance_expense').select('id, wedding_id, description, category, amount, currency_code, paid_at, paid_by_host_group_id, note').in('wedding_id', weddingIds),
    app.from('vendor').select('id, wedding_id, category, name, contact_name, email, phone').in('wedding_id', weddingIds),
    app.from('engagement').select('vendor_id, wedding_id, event_instance_id, state, role_title, quote_amount, quote_currency').in('wedding_id', weddingIds),
    app.from('event_instance').select('id, wedding_id, event_function_id').in('wedding_id', weddingIds),
    app.from('event_function').select('id, name').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, groups, net, expenses, vendors, engs, insts, funcs]) if (r.error) throw r.error;

  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const funcNameById = new Map((funcs.data ?? []).map((f) => [f.id, f.name]));
  const instFuncName = new Map((insts.data ?? []).map((i) => [i.id, funcNameById.get(i.event_function_id) ?? null]));
  const engByVendor = new Map<string, FamilyEngagement[]>();
  for (const e of engs.data ?? []) {
    const arr = engByVendor.get(e.vendor_id) ?? [];
    arr.push({
      roleTitle: e.role_title ?? null, state: e.state,
      quoteAmount: e.quote_amount != null ? Number(e.quote_amount) : null, quoteCurrency: e.quote_currency ?? null,
      eventName: e.event_instance_id ? instFuncName.get(e.event_instance_id) ?? null : null,
    });
    engByVendor.set(e.vendor_id, arr);
  }

  return (weds.data ?? []).map((w) => {
    const adminGroupId = ctx.byWedding[w.id].adminGroupId as string;
    return {
      weddingId: w.id,
      title: w.title,
      adminGroupId,
      adminGroupName: groupName.get(adminGroupId) ?? null,
      net: (net.data ?? [])
        .filter((r) => r.wedding_id === w.id)
        .map((r) => ({
          groupName: groupName.get(r.host_group_id) ?? '—', currency: r.currency_code,
          paid: Number(r.paid_amount), allocated: Number(r.allocated_amount), net: Number(r.net_position),
          mine: r.host_group_id === adminGroupId,
        }))
        .sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || a.groupName.localeCompare(b.groupName)),
      expenses: (expenses.data ?? [])
        .filter((e) => e.wedding_id === w.id)
        .map((e) => ({
          id: e.id, description: e.description, category: e.category, amount: Number(e.amount), currency: e.currency_code,
          paidAt: e.paid_at, paidByName: groupName.get(e.paid_by_host_group_id) ?? null, note: e.note ?? null,
        }))
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      vendors: (vendors.data ?? [])
        .filter((v) => v.wedding_id === w.id)
        .map((v) => ({
          id: v.id, name: v.name, category: v.category, contactName: v.contact_name ?? null, phone: v.phone ?? null, email: v.email ?? null,
          engagements: engByVendor.get(v.id) ?? [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
