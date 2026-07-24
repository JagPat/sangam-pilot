import {
  formatMoney, chargeableUnits,
  type GuestServicesData, type GuestServiceItem, type GuestServiceHousehold, type ServiceBooking,
} from '@/lib/data/services';
import { bookService, cancelServiceRequest } from './actions';

// Presentational "services" for the guest (used by /stay and the fixture preview). Two groups: what the host
// is offering ("Included with your stay") and what the guest can add at their own cost. The loader has already
// limited requests to the caller's own; the forms post to the guest actions, guarded by 0019 RLS.

const SETTLE_BADGE: Record<string, { label: string; cls: string }> = {
  none: { label: '', cls: '' },
  due: { label: 'Payment due', cls: 'is-wait' },
  settled: { label: 'Paid', cls: 'is-on' },
  waived: { label: 'Waived', cls: 'is-off' },
};

function terms(svc: GuestServiceItem): string {
  const unit = svc.unitLabel ? ` ${svc.unitLabel}` : '';
  if (svc.billing === 'included') return 'Included by your hosts';
  if (svc.billing === 'allowance') return `First ${svc.includedQty} included, then ${formatMoney(svc.priceCents, svc.currency)}${unit} each`;
  return `${formatMoney(svc.priceCents, svc.currency)}${unit}`;
}

function BookingControl({
  svc, householdId, guestId, label,
}: { svc: GuestServiceItem; householdId: string; guestId: string | null; label: string | null }) {
  const booking: ServiceBooking | undefined = svc.bookings.find(
    (b) => b.householdId === householdId && (guestId ? b.guestId === guestId : b.guestId === null),
  );
  const charge = booking ? booking.chargeCents : chargeableUnits(svc.billing, 1, svc.includedQty) * svc.priceCents;
  const settle = booking ? SETTLE_BADGE[booking.settle] : null;
  const cta = svc.billing === 'guest_paid' ? 'Add' : 'Request';

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      {label ? <div style={{ minWidth: 110, fontWeight: 500 }}>{label}</div> : null}
      <form action={bookService} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
        <input type="hidden" name="weddingId" value={svc.weddingId} />
        <input type="hidden" name="serviceId" value={svc.id} />
        <input type="hidden" name="householdId" value={householdId} />
        {guestId ? <input type="hidden" name="guestId" value={guestId} /> : null}
        {booking ? <input type="hidden" name="requestId" value={booking.id} /> : null}
        <input className="sg-input" type="number" name="qty" min={1} max={99} defaultValue={booking?.qty ?? 1} style={{ maxWidth: 74 }} aria-label="Quantity" />
        <button type="submit" className={`sg-btn sg-btn--sm ${booking ? 'sg-btn--ghost' : 'sg-btn--primary'}`}>{booking ? 'Update' : cta}</button>
      </form>
      {booking ? (
        <>
          {charge > 0 ? <span className="sg-chip">You pay {formatMoney(charge, svc.currency)}</span> : svc.billing !== 'guest_paid' ? <span className="sg-badge is-on">Included</span> : null}
          {settle && settle.label ? <span className={`sg-badge ${settle.cls}`}>{settle.label}</span> : null}
          <form action={cancelServiceRequest} style={{ display: 'inline' }}>
            <input type="hidden" name="requestId" value={booking.id} />
            <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Remove</button>
          </form>
        </>
      ) : (
        svc.billing === 'guest_paid' && charge > 0 ? <span className="sg-muted" style={{ fontSize: 12 }}>from {formatMoney(charge, svc.currency)}</span> : null
      )}
    </div>
  );
}

function ServiceCard({ svc, households }: { svc: GuestServiceItem; households: GuestServiceHousehold[] }) {
  return (
    <div className="sg-section" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>{svc.name}</h2>
        {svc.category ? <span className="sg-badge is-off">{svc.category}</span> : null}
      </div>
      {svc.description ? <p className="sg-muted" style={{ margin: '6px 0 0' }}>{svc.description}</p> : null}
      <p style={{ margin: '8px 0 4px', fontWeight: 500, color: 'var(--gold-deep)' }}>{terms(svc)}</p>
      {households.map((hh) =>
        svc.scope === 'per_household' ? (
          <BookingControl key={hh.householdId} svc={svc} householdId={hh.householdId} guestId={null} label={households.length > 1 ? hh.householdName : null} />
        ) : (
          hh.guests.map((g) => (
            <BookingControl key={g.guestId} svc={svc} householdId={hh.householdId} guestId={g.guestId} label={g.guestName ?? 'Guest'} />
          ))
        ),
      )}
    </div>
  );
}

export function MyServicesView({ data }: { data: GuestServicesData }) {
  if (data.included.length === 0 && data.paid.length === 0) return null;
  return (
    <>
      {data.included.length ? (
        <>
          <div className="sg-section__kicker" style={{ marginTop: 8 }}>Included with your stay</div>
          {data.included.map((svc) => <ServiceCard key={svc.id} svc={svc} households={data.households} />)}
        </>
      ) : null}
      {data.paid.length ? (
        <>
          <div className="sg-section__kicker" style={{ marginTop: 8 }}>Add at your own cost</div>
          {data.paid.map((svc) => <ServiceCard key={svc.id} svc={svc} households={data.households} />)}
        </>
      ) : null}
    </>
  );
}
