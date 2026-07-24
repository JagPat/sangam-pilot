import { VENDOR_CATEGORY, ENGAGEMENT_STATE, formatAmount, type FamilyBudgetWedding, type FamilyVendor, type NetRow } from '@/lib/data/family-finance';

// Read-only "Finance & vendors" for a family admin (their own side) — used by /host/budget + the fixture
// preview. Money and vendor writes stay with the event manager; this is visibility into the split and the
// suppliers this side sources. Data is already scoped by RLS (0011 finance + 0022 vendor read).

function netLabel(r: NetRow): string {
  if (Math.abs(r.net) < 0.005) return 'Settled';
  return r.net > 0 ? `Owed ${formatAmount(r.net, r.currency)}` : `Owes ${formatAmount(-r.net, r.currency)}`;
}

function VendorCard({ v }: { v: FamilyVendor }) {
  const contact = [v.contactName, v.phone, v.email].filter(Boolean).join(' · ');
  return (
    <div className="sg-section" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>{v.name} <span className="sg-muted" style={{ fontSize: 14, fontWeight: 400 }}>· {VENDOR_CATEGORY[v.category] ?? v.category}</span></h2>
      </div>
      {contact ? <p className="sg-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{contact}</p> : null}
      {v.engagements.length ? (
        <div className="sg-chips">
          {v.engagements.map((e, i) => {
            const st = ENGAGEMENT_STATE[e.state] ?? { label: e.state, cls: 'is-off' };
            const bits = [e.roleTitle, e.eventName, e.quoteAmount != null ? formatAmount(e.quoteAmount, e.quoteCurrency ?? 'INR') : null].filter(Boolean).join(' · ');
            return <span key={i} className="sg-chip"><span className={`sg-badge ${st.cls}`}>{st.label}</span>{bits ? ` ${bits}` : ''}</span>;
          })}
        </div>
      ) : <p className="sg-muted" style={{ margin: '8px 0 0', fontSize: 13 }}>No bookings recorded yet.</p>}
    </div>
  );
}

export function FamilyBudgetWeddingView({ w }: { w: FamilyBudgetWedding }) {
  return (
    <>
      <div className="sg-pagehead">
        <h1>Finance &amp; vendors · {w.title}</h1>
        <p>A read-only view for {w.adminGroupName ? <strong>{w.adminGroupName}</strong> : 'your side'}: how the spend splits between the families, the expenses your side is part of, and the vendors your side is sourcing. The event manager records expenses and manages vendors.</p>
      </div>

      <section className="sg-section">
        <h2>The split</h2>
        {w.net.length === 0 ? (
          <p className="sg-muted">Nothing recorded yet — once the event manager logs expenses, the family split shows here.</p>
        ) : (
          <div className="sg-tablewrap">
            <table className="sg-table">
              <thead><tr><th>Family</th><th>Paid</th><th>Responsible for</th><th>Position</th></tr></thead>
              <tbody>
                {w.net.map((r, i) => (
                  <tr key={i} style={r.mine ? { background: 'var(--ivory)' } : undefined}>
                    <td><strong>{r.groupName}</strong>{r.mine ? <span className="sg-badge is-on" style={{ marginLeft: 6 }}>You</span> : null}</td>
                    <td>{formatAmount(r.paid, r.currency)}</td>
                    <td>{formatAmount(r.allocated, r.currency)}</td>
                    <td><span className={`sg-badge ${Math.abs(r.net) < 0.005 ? 'is-off' : r.net > 0 ? 'is-on' : 'is-wait'}`}>{netLabel(r)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sg-muted" style={{ marginTop: 8, fontSize: 13 }}>“Position” is what a family has paid minus what it’s responsible for — positive means it’s owed money, negative means it owes.</p>
          </div>
        )}
      </section>

      <section className="sg-section">
        <h2>Expenses your side is part of</h2>
        {w.expenses.length === 0 ? (
          <p className="sg-muted">No expenses yet that involve your side.</p>
        ) : (
          <div className="sg-tablewrap">
            <table className="sg-table">
              <thead><tr><th>Expense</th><th>Category</th><th>Amount</th><th>Paid by</th><th>When</th></tr></thead>
              <tbody>
                {w.expenses.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.description}</strong>{e.note ? <div className="sg-muted" style={{ fontSize: 12 }}>{e.note}</div> : null}</td>
                    <td className="sg-muted">{e.category}</td>
                    <td>{formatAmount(e.amount, e.currency)}</td>
                    <td className="sg-muted">{e.paidByName ?? '—'}</td>
                    <td className="sg-muted">{e.paidAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sg-section">
        <h2>Your side’s vendors ({w.vendors.length})</h2>
        {w.vendors.length === 0 ? <p className="sg-muted">No vendors sourced by your side yet — the event manager can tag a vendor to your side.</p> : null}
      </section>
      {w.vendors.map((v) => <VendorCard key={v.id} v={v} />)}
    </>
  );
}
