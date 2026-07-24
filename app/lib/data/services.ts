import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Services module (Stay & Travel, layer 3). One "who pays" flag per service segregates everything:
//   included   → the host bulk-buys / offers it; guest sees it free (price_cents is the host's unit cost)
//   allowance  → host covers up to included_qty per person/household; guest pays price_cents per overage unit
//   guest_paid → guest buys it entirely; guest pays price_cents per unit
// Payment is OFF-PLATFORM: we record the charge + a settlement state; the guest pays at the desk / on their
// hotel folio / via a vendor link. This file has the shared labels + money maths and both read models
// (guest menu, owner catalogue + request queue). Writes go through the server actions.

export const SERVICE_BILLING = [
  { value: 'included', label: 'Included by the host' },
  { value: 'allowance', label: 'Included up to a limit' },
  { value: 'guest_paid', label: 'Guest pays' },
] as const;
export const SERVICE_SCOPE = [
  { value: 'per_person', label: 'Per person' },
  { value: 'per_household', label: 'Per household' },
] as const;
export const SETTLE_VIA = [
  { value: 'hotel_folio', label: 'Charged to the hotel room' },
  { value: 'front_desk', label: 'Pay at the desk' },
  { value: 'vendor_link', label: 'Vendor payment link' },
  { value: 'cash', label: 'Cash' },
] as const;

export const BILLING_LABEL: Record<string, string> = Object.fromEntries(SERVICE_BILLING.map((b) => [b.value, b.label]));
export const SETTLE_VIA_LABEL: Record<string, string> = Object.fromEntries(SETTLE_VIA.map((s) => [s.value, s.label]));

export function formatMoney(cents: number, currency = 'INR'): string {
  const n = (cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (currency === 'INR' ? '₹' : `${currency} `) + n;
}

// How many units the guest actually pays for, given the billing tier + requested qty + free allowance.
export function chargeableUnits(billing: string, qty: number, includedQty: number | null): number {
  if (billing === 'included') return 0;
  if (billing === 'allowance') return Math.max(0, qty - (includedQty ?? 0));
  return qty; // guest_paid
}

// ---------------- guest menu ----------------

export type ServiceBooking = {
  id: string; guestId: string | null; householdId: string; qty: number; status: string; settle: string;
  notes: string | null; chargeCents: number;
};
export type GuestServiceItem = {
  id: string; weddingId: string; name: string; description: string | null; category: string | null;
  billing: string; priceCents: number; currency: string; unitLabel: string | null; includedQty: number | null;
  scope: string; settleHint: string; bookings: ServiceBooking[];
};
export type GuestServiceHousehold = { householdId: string; householdName: string | null; guests: { guestId: string; guestName: string | null }[] };
export type GuestServicesData = {
  households: GuestServiceHousehold[];
  included: GuestServiceItem[]; // billing 'included' or 'allowance' — the host is offering these
  paid: GuestServiceItem[];     // billing 'guest_paid' — at the guest's cost
};

export async function getGuestServices(db: AppSupabaseClient): Promise<GuestServicesData> {
  const app = db.schema('app');
  const guests = await app.from('guest').select('id, wedding_id, household_id, full_name'); // RLS → only actable
  if (guests.error) throw guests.error;
  const gs = guests.data ?? [];
  if (gs.length === 0) return { households: [], included: [], paid: [] };

  const weddingIds = [...new Set(gs.map((g) => g.wedding_id))];
  const householdIds = [...new Set(gs.map((g) => g.household_id))];
  const [households, services, reqs] = await Promise.all([
    app.from('household').select('id, name').in('id', householdIds),
    app.from('service').select('id, wedding_id, name, description, category, billing, price_cents, currency, unit_label, included_qty, scope, settle_hint, active').in('wedding_id', weddingIds).eq('active', true),
    app.from('service_request').select('id, service_id, household_id, guest_id, qty, status, settle, notes').in('wedding_id', weddingIds), // RLS → only the caller's
  ]);
  if (households.error) throw households.error;
  if (services.error) throw services.error;
  if (reqs.error) throw reqs.error;

  const hhName = new Map((households.data ?? []).map((h) => [h.id, h.name]));
  const guestsByHh = new Map<string, { guestId: string; guestName: string | null }[]>();
  for (const g of gs) {
    const arr = guestsByHh.get(g.household_id) ?? [];
    arr.push({ guestId: g.id, guestName: g.full_name ?? null });
    guestsByHh.set(g.household_id, arr);
  }
  const householdsOut: GuestServiceHousehold[] = householdIds.map((id) => ({
    householdId: id, householdName: hhName.get(id) ?? null, guests: guestsByHh.get(id) ?? [],
  }));

  const bookingsByService = new Map<string, ServiceBooking[]>();
  const svcById = new Map((services.data ?? []).map((s) => [s.id, s]));
  for (const r of reqs.data ?? []) {
    if (r.status === 'cancelled') continue;
    const svc = svcById.get(r.service_id);
    const charge = svc ? chargeableUnits(svc.billing, r.qty, svc.included_qty) * svc.price_cents : 0;
    const arr = bookingsByService.get(r.service_id) ?? [];
    arr.push({ id: r.id, guestId: r.guest_id ?? null, householdId: r.household_id, qty: r.qty, status: r.status, settle: r.settle, notes: r.notes ?? null, chargeCents: charge });
    bookingsByService.set(r.service_id, arr);
  }

  const items: GuestServiceItem[] = (services.data ?? []).map((s) => ({
    id: s.id, weddingId: s.wedding_id, name: s.name, description: s.description ?? null, category: s.category ?? null,
    billing: s.billing, priceCents: s.price_cents, currency: s.currency, unitLabel: s.unit_label ?? null,
    includedQty: s.included_qty ?? null, scope: s.scope, settleHint: s.settle_hint,
    bookings: bookingsByService.get(s.id) ?? [],
  }));

  return {
    households: householdsOut,
    included: items.filter((i) => i.billing !== 'guest_paid'),
    paid: items.filter((i) => i.billing === 'guest_paid'),
  };
}

// ---------------- owner catalogue + request queue ----------------

export type ConsoleService = {
  id: string; name: string; description: string | null; category: string | null; billing: string;
  priceCents: number; currency: string; unitLabel: string | null; includedQty: number | null; scope: string;
  settleHint: string; active: boolean; requestCount: number;
};
export type ServiceQueueItem = {
  id: string; serviceName: string; billing: string; scope: string; who: string; guestId: string | null;
  householdId: string; qty: number; status: string; settle: string; notes: string | null;
  chargeCents: number; currency: string; settleHint: string;
};
export type ConsoleServicesWedding = {
  weddingId: string; title: string; services: ConsoleService[]; queue: ServiceQueueItem[];
  totals: { hostCostCents: number; guestChargesCents: number; outstanding: number; currency: string };
};

export async function getConsoleServices(db: AppSupabaseClient): Promise<ConsoleServicesWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, services, reqs, households, guests] = await Promise.all([
    app.from('wedding').select('id, title').in('id', weddingIds),
    app.from('service').select('id, wedding_id, name, description, category, billing, price_cents, currency, unit_label, included_qty, scope, settle_hint, active, sort_order').in('wedding_id', weddingIds),
    app.from('service_request').select('id, wedding_id, service_id, household_id, guest_id, qty, status, settle, notes').in('wedding_id', weddingIds),
    app.from('household').select('id, wedding_id, name').in('wedding_id', weddingIds),
    app.from('guest').select('id, wedding_id, full_name').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, services, reqs, households, guests]) if (r.error) throw r.error;

  const hhName = new Map((households.data ?? []).map((h) => [h.id, h.name]));
  const guestName = new Map((guests.data ?? []).map((g) => [g.id, g.full_name ?? null]));

  return (weds.data ?? []).map((w) => {
    const wServices = (services.data ?? []).filter((s) => s.wedding_id === w.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const svcById = new Map(wServices.map((s) => [s.id, s]));
    const wReqs = (reqs.data ?? []).filter((r) => r.wedding_id === w.id && r.status !== 'cancelled');

    const reqCount = new Map<string, number>();
    for (const r of wReqs) reqCount.set(r.service_id, (reqCount.get(r.service_id) ?? 0) + 1);

    const servicesOut: ConsoleService[] = wServices.map((s) => ({
      id: s.id, name: s.name, description: s.description ?? null, category: s.category ?? null, billing: s.billing,
      priceCents: s.price_cents, currency: s.currency, unitLabel: s.unit_label ?? null, includedQty: s.included_qty ?? null,
      scope: s.scope, settleHint: s.settle_hint, active: s.active, requestCount: reqCount.get(s.id) ?? 0,
    }));

    let hostCost = 0, guestCharges = 0, outstanding = 0;
    const currency = wServices[0]?.currency ?? 'INR';
    const queue: ServiceQueueItem[] = wReqs.map((r) => {
      const svc = svcById.get(r.service_id);
      const charge = svc ? chargeableUnits(svc.billing, r.qty, svc.included_qty) * svc.price_cents : 0;
      if (svc && svc.billing === 'included') hostCost += r.qty * svc.price_cents;
      else if (svc && svc.billing === 'allowance') hostCost += Math.min(r.qty, svc.included_qty ?? 0) * svc.price_cents;
      guestCharges += charge;
      if (charge > 0 && r.settle !== 'settled' && r.settle !== 'waived') outstanding += 1;
      return {
        id: r.id, serviceName: svc?.name ?? '—', billing: svc?.billing ?? 'guest_paid', scope: svc?.scope ?? 'per_household',
        who: r.guest_id ? (guestName.get(r.guest_id) ?? '—') : (hhName.get(r.household_id) ?? '—'),
        guestId: r.guest_id ?? null, householdId: r.household_id, qty: r.qty, status: r.status, settle: r.settle,
        notes: r.notes ?? null, chargeCents: charge, currency: svc?.currency ?? currency, settleHint: svc?.settle_hint ?? 'front_desk',
      };
    }).sort((a, b) => a.serviceName.localeCompare(b.serviceName) || a.who.localeCompare(b.who));

    return { weddingId: w.id, title: w.title, services: servicesOut, queue, totals: { hostCostCents: hostCost, guestChargesCents: guestCharges, outstanding, currency } };
  });
}
