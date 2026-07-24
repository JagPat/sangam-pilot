import {
  SERVICE_BILLING, SERVICE_SCOPE, SETTLE_VIA, BILLING_LABEL, formatMoney,
  type ConsoleServicesWedding, type ConsoleService, type ServiceQueueItem,
} from '@/lib/data/services';
import { saveService, setServiceActive, setServiceRequestState } from './actions';

// Presentational services console (used by /host/stay). The owner defines the catalogue (each item tagged
// included / allowance / guest_paid) and works the request queue: fulfil requests and, for guest-paid ones,
// record the off-platform settlement. Data comes from getConsoleServices; writes go through the actions.

const BILL_BADGE: Record<string, string> = { included: 'is-on', allowance: 'is-wait', guest_paid: 'is-off' };
const REQ_STATUS = ['requested', 'confirmed', 'delivered', 'declined'];
const SETTLE_OPTS = ['due', 'settled', 'waived'];

function terms(s: ConsoleService): string {
  const unit = s.unitLabel ? ` ${s.unitLabel}` : '';
  if (s.billing === 'included') return `Included · host cost ${formatMoney(s.priceCents, s.currency)}${unit}`;
  if (s.billing === 'allowance') return `First ${s.includedQty} free, then ${formatMoney(s.priceCents, s.currency)}${unit}`;
  return `${formatMoney(s.priceCents, s.currency)}${unit} · guest pays`;
}

// The shared field grid, used for both "add" and inline "edit".
function ServiceFields({ weddingId, svc }: { weddingId: string; svc?: ConsoleService }) {
  return (
    <>
      <input type="hidden" name="weddingId" value={weddingId} />
      {svc ? <input type="hidden" name="serviceId" value={svc.id} /> : null}
      <div className="sg-field" style={{ flex: '2 1 220px' }}><label>Name *</label><input className="sg-input" name="name" required defaultValue={svc?.name ?? ''} placeholder="e.g. Spa treatment" /></div>
      <div className="sg-field"><label>Category</label><input className="sg-input" name="category" defaultValue={svc?.category ?? ''} placeholder="wellness" style={{ maxWidth: 150 }} /></div>
      <div className="sg-field"><label>Who pays</label>
        <select className="sg-select" name="billing" defaultValue={svc?.billing ?? 'guest_paid'}>
          {SERVICE_BILLING.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </div>
      <div className="sg-field"><label>Per</label>
        <select className="sg-select" name="scope" defaultValue={svc?.scope ?? 'per_person'}>
          {SERVICE_SCOPE.map((sc) => <option key={sc.value} value={sc.value}>{sc.label}</option>)}
        </select>
      </div>
      <div className="sg-field"><label>Price (₹)</label><input className="sg-input" name="price" type="number" min={0} step="0.01" defaultValue={svc ? svc.priceCents / 100 : ''} placeholder="0" style={{ maxWidth: 110 }} /></div>
      <div className="sg-field"><label>Unit</label><input className="sg-input" name="unitLabel" defaultValue={svc?.unitLabel ?? ''} placeholder="per treatment" style={{ maxWidth: 140 }} /></div>
      <div className="sg-field"><label>Free qty (allowance)</label><input className="sg-input" name="includedQty" type="number" min={1} defaultValue={svc?.includedQty ?? ''} placeholder="—" style={{ maxWidth: 90 }} /></div>
      <div className="sg-field"><label>Settles via</label>
        <select className="sg-select" name="settleHint" defaultValue={svc?.settleHint ?? 'front_desk'}>
          {SETTLE_VIA.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </div>
      <div className="sg-field" style={{ flex: '1 1 100%' }}><label>Description</label><input className="sg-input" name="description" defaultValue={svc?.description ?? ''} placeholder="Shown to guests on their Stay screen" /></div>
    </>
  );
}

function CatalogueRow({ weddingId, svc }: { weddingId: string; svc: ConsoleService }) {
  return (
    <details style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
      <summary style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{svc.name}</strong>
        <span className={`sg-badge ${BILL_BADGE[svc.billing] ?? 'is-off'}`}>{BILLING_LABEL[svc.billing] ?? svc.billing}</span>
        <span className="sg-muted" style={{ fontSize: 13 }}>{terms(svc)} · {svc.scope === 'per_person' ? 'per person' : 'per household'}</span>
        {svc.requestCount ? <span className="sg-chip">{svc.requestCount} request{svc.requestCount === 1 ? '' : 's'}</span> : null}
        {!svc.active ? <span className="sg-badge is-off">Hidden</span> : null}
      </summary>
      <form action={saveService} className="sg-formrow" style={{ marginTop: 10 }}>
        <ServiceFields weddingId={weddingId} svc={svc} />
        <button type="submit" className="sg-btn sg-btn--primary">Save changes</button>
      </form>
      <form action={setServiceActive} style={{ marginTop: 8 }}>
        <input type="hidden" name="weddingId" value={weddingId} />
        <input type="hidden" name="serviceId" value={svc.id} />
        <input type="hidden" name="active" value={svc.active ? '' : 'on'} />
        <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm">{svc.active ? 'Hide from guests' : 'Show to guests'}</button>
      </form>
    </details>
  );
}

function QueueRow({ weddingId, it }: { weddingId: string; it: ServiceQueueItem }) {
  const chargeable = it.chargeCents > 0;
  return (
    <tr>
      <td><strong>{it.serviceName}</strong><div className="sg-muted" style={{ fontSize: 12 }}>{it.who} · ×{it.qty}</div></td>
      <td><span className={`sg-badge ${BILL_BADGE[it.billing] ?? 'is-off'}`}>{BILLING_LABEL[it.billing] ?? it.billing}</span></td>
      <td>{chargeable ? <><strong>{formatMoney(it.chargeCents, it.currency)}</strong><div className="sg-muted" style={{ fontSize: 12 }}>{it.settle === 'settled' ? 'Paid' : it.settle === 'waived' ? 'Waived' : 'Due'}</div></> : <span className="sg-muted">Host</span>}</td>
      <td>{it.notes ? <span className="sg-muted" style={{ fontSize: 12 }}>{it.notes}</span> : '—'}</td>
      <td>
        <form action={setServiceRequestState} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="weddingId" value={weddingId} />
          <input type="hidden" name="requestId" value={it.id} />
          <select className="sg-select" name="status" defaultValue={it.status} style={{ minWidth: 120 }}>
            {REQ_STATUS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          {chargeable ? (
            <select className="sg-select" name="settle" defaultValue={it.settle === 'none' ? 'due' : it.settle} style={{ minWidth: 110 }}>
              {SETTLE_OPTS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          ) : null}
          <button type="submit" className="sg-btn sg-btn--ghost sg-btn--sm">Update</button>
        </form>
      </td>
    </tr>
  );
}

export function ServicesConsoleView({ s }: { s: ConsoleServicesWedding }) {
  const t = s.totals;
  return (
    <>
      <section className="sg-section">
        <h2>Services</h2>
        <div className="sg-tiles">
          <div className="sg-tile"><div className="sg-tile__num">{formatMoney(t.hostCostCents, t.currency)}</div><div className="sg-tile__label">Host cost (included)</div></div>
          <div className="sg-tile"><div className="sg-tile__num">{formatMoney(t.guestChargesCents, t.currency)}</div><div className="sg-tile__label">Guest charges</div></div>
          <div className="sg-tile"><div className="sg-tile__num">{t.outstanding}</div><div className="sg-tile__label">Awaiting payment</div></div>
        </div>

        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, margin: '4px 0 8px' }}>Add a service</h3>
        <form action={saveService} className="sg-formrow">
          <ServiceFields weddingId={s.weddingId} />
          <button type="submit" className="sg-btn sg-btn--primary">Add service</button>
        </form>
        <p className="sg-muted" style={{ marginTop: 8, fontSize: 13 }}>
          “Included” is your bulk buy (free to guests, counts as your cost). “Included up to a limit” covers a set quantity, guest pays the rest. “Guest pays” is entirely at their cost — payment is settled off-platform.
        </p>

        {s.services.length ? (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, margin: '4px 0 4px' }}>Your menu ({s.services.length})</h3>
            {s.services.map((svc) => <CatalogueRow key={svc.id} weddingId={s.weddingId} svc={svc} />)}
          </div>
        ) : null}
      </section>

      <section className="sg-section">
        <h2>Service requests</h2>
        {s.queue.length === 0 ? (
          <p className="sg-muted">No requests yet — guests book services from their “Your stay” screen.</p>
        ) : (
          <div className="sg-tablewrap">
            <table className="sg-table">
              <thead><tr><th>Request</th><th>Billing</th><th>Charge</th><th>Notes</th><th>Fulfil / settle</th></tr></thead>
              <tbody>{s.queue.map((it) => <QueueRow key={it.id} weddingId={s.weddingId} it={it} />)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
