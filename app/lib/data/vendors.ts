import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the vendor board (/host/vendors): the vendors an owner has, each with its engagements
// (bookings), plus the wedding's events and families for the engagement/assignment dropdowns. READ ONLY;
// mutations go through app/host/vendors/actions.ts (direct owner-RLS writes on vendor / engagement).

export const VENDOR_CATEGORIES = [
  'music', 'dj', 'band', 'mc', 'hair', 'makeup', 'decor', 'florist', 'catering', 'photo', 'transport', 'pandit', 'other',
] as const;
export const ENGAGEMENT_STATES = [
  'shortlisted', 'inquired', 'quoted', 'confirmed', 'declined', 'cancelled',
] as const;

export type VendorEngagement = {
  id: string;
  eventInstanceId: string | null;
  eventName: string | null;
  state: string;
  roleTitle: string | null;
  blurb: string | null;
  quoteAmount: number | null;
  quoteCurrency: string | null;
  notes: string | null;
};

export type VendorRow = {
  id: string;
  category: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  hostGroupId: string | null;
  notes: string | null;
  engagements: VendorEngagement[];
};

export type VendorEvent = { id: string; name: string };
export type VendorFamily = { id: string; name: string; kind: string };

export type VendorsWedding = {
  weddingId: string;
  title: string;
  families: VendorFamily[];
  events: VendorEvent[];
  vendors: VendorRow[];
};

export async function getVendorsData(db: AppSupabaseClient): Promise<VendorsWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, vendors, engs, insts, funcs, groups] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('vendor').select('id, wedding_id, category, name, contact_name, email, phone, host_group_id, notes').in('wedding_id', weddingIds),
    app.from('engagement').select('id, wedding_id, vendor_id, event_instance_id, state, role_title, blurb, quote_amount, quote_currency, notes').in('wedding_id', weddingIds),
    app.from('event_instance').select('id, wedding_id, event_function_id, arrival').in('wedding_id', weddingIds),
    app.from('event_function').select('id, name').in('wedding_id', weddingIds),
    app.from('host_group').select('id, wedding_id, name, kind').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, vendors, engs, insts, funcs, groups]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((f) => [f.id, f]));
  const nameByInstance = new Map((insts.data ?? []).map((i) => [i.id, funcById.get(i.event_function_id)?.name ?? null]));

  const engsByVendor = new Map<string, VendorEngagement[]>();
  for (const e of engs.data ?? []) {
    const arr = engsByVendor.get(e.vendor_id) ?? [];
    arr.push({
      id: e.id,
      eventInstanceId: e.event_instance_id ?? null,
      eventName: e.event_instance_id ? (nameByInstance.get(e.event_instance_id) ?? null) : null,
      state: e.state,
      roleTitle: e.role_title ?? null,
      blurb: e.blurb ?? null,
      quoteAmount: e.quote_amount ?? null,
      quoteCurrency: e.quote_currency ?? null,
      notes: e.notes ?? null,
    });
    engsByVendor.set(e.vendor_id, arr);
  }

  return (weds.data ?? []).map((w) => ({
    weddingId: w.id,
    title: w.title,
    families: (groups.data ?? []).filter((g) => g.wedding_id === w.id).map((g) => ({ id: g.id, name: g.name, kind: g.kind })),
    events: (insts.data ?? [])
      .filter((i) => i.wedding_id === w.id)
      .map((i) => ({ id: i.id, name: funcById.get(i.event_function_id)?.name ?? 'Event', when: i.arrival?.instant ?? '' }))
      .sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''))
      .map(({ id, name }) => ({ id, name })),
    vendors: (vendors.data ?? [])
      .filter((v) => v.wedding_id === w.id)
      .map((v) => ({
        id: v.id,
        category: v.category,
        name: v.name,
        contactName: v.contact_name ?? null,
        email: v.email ?? null,
        phone: v.phone ?? null,
        hostGroupId: v.host_group_id ?? null,
        notes: v.notes ?? null,
        engagements: engsByVendor.get(v.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
