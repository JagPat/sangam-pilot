import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getFinanceData, type FinanceWedding, type FinanceExpense } from '@/lib/data/finance';
import { addExpense, updateExpense, deleteExpense } from './actions';
import { HostNav } from '../HostNav';

export const dynamic = 'force-dynamic';

const CURRENCIES = ['INR', 'USD'];

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  '1': { kind: 'ok', text: 'Saved.' },
  fields: { kind: 'err', text: 'Please fill in the description, amount, date, and who paid.' },
  alloc: { kind: 'err', text: 'Add at least one responsible family (an allocation).' },
  save: { kind: 'err', text: "Couldn't save — check that the split totals 100% (percentage) or the full amount (fixed), and try again." },
};

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function ExpenseForm({ w, e }: { w: FinanceWedding; e?: FinanceExpense }) {
  const editing = !!e;
  const action = editing ? updateExpense : addExpense;
  const allocFor = (gid: string) => e?.allocations.find((a) => a.groupId === gid)?.amount ?? '';
  return (
    <form action={action} style={{ display: 'grid', gap: 14 }}>
      <input type="hidden" name="weddingId" value={w.weddingId} />
      {editing ? <input type="hidden" name="expenseId" value={e!.id} /> : null}

      <div className="sg-field">
        <label className="sg-label">Description *</label>
        <input className="sg-input" name="description" required defaultValue={e?.description ?? ''} placeholder="e.g. Decor deposit" />
      </div>

      <div className="sg-formrow">
        <div className="sg-field">
          <label className="sg-label">Category</label>
          <input className="sg-input" name="category" defaultValue={e?.category ?? ''} placeholder="venue, catering, decor…" />
        </div>
        <div className="sg-field">
          <label className="sg-label">Paid on *</label>
          <input className="sg-input" type="date" name="paidAt" required defaultValue={e?.paidAt ?? ''} />
        </div>
        <div className="sg-field">
          <label className="sg-label">Amount *</label>
          <input className="sg-input" type="number" step="0.01" min="0" name="amount" required defaultValue={e?.amount ?? ''} />
        </div>
        <div className="sg-field">
          <label className="sg-label">Currency</label>
          <select className="sg-select" name="currency" defaultValue={e?.currency ?? 'INR'}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="sg-field">
        <label className="sg-label">Paid by *</label>
        <select className="sg-select" name="paidBy" required defaultValue={e?.paidByGroupId ?? ''}>
          <option value="" disabled>— choose family —</option>
          {w.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <span className="sg-label">Responsible split — enter a value for each family that shares this cost:</span>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label><input type="radio" name="basis" value="percent" defaultChecked={!editing} /> Percentages (total 100%)</label>
          <label><input type="radio" name="basis" value="amount" defaultChecked={editing} /> Fixed amounts (total the amount)</label>
        </div>
        <div className="sg-formrow">
          {w.groups.map((g) => (
            <div className="sg-field" key={g.id}>
              <label className="sg-label">{g.name}</label>
              <input className="sg-input" type="number" step="0.01" min="0" name={`alloc_${g.id}`} defaultValue={allocFor(g.id)} placeholder="0" />
            </div>
          ))}
        </div>
      </div>

      <div className="sg-field">
        <label className="sg-label">Note</label>
        <input className="sg-input" name="note" defaultValue={e?.note ?? ''} placeholder="optional" />
      </div>

      <div><button type="submit" className="sg-btn sg-btn--primary">{editing ? 'Save changes' : 'Add expense'}</button></div>
    </form>
  );
}

function NetPosition({ w }: { w: FinanceWedding }) {
  if (w.netByCurrency.length === 0) return <p className="sg-muted">No expenses recorded yet.</p>;
  return (
    <>
      {w.netByCurrency.map((block) => (
        <div key={block.currency} style={{ marginBottom: 16 }}>
          <div className="sg-section__kicker">{block.currency}</div>
          <div className="sg-tablewrap">
            <table className="sg-table">
              <thead><tr>
                <th>Family</th>
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th style={{ textAlign: 'right' }}>Allocated</th>
                <th style={{ textAlign: 'right' }}>Net position</th>
              </tr></thead>
              <tbody>
                {block.rows.map((r) => (
                  <tr key={r.groupId}>
                    <td>{r.groupName ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.paid, block.currency)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.allocated, block.currency)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.net > 0
                        ? <span className="sg-badge is-on">ahead {money(r.net, block.currency)}</span>
                        : r.net < 0
                        ? <span className="sg-badge is-wait">behind {money(-r.net, block.currency)}</span>
                        : <span className="sg-badge is-off">even</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="sg-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
        Net position = total paid − total allocated, per family, per currency. A positive figure means the family has paid more
        than its share; negative means it owes. Currencies are kept separate and never combined. With three or more families the
        exact set of repaying transfers is not unique — this shows standings, not a single settlement instruction.
      </p>
    </>
  );
}

function WeddingFinance({ w }: { w: FinanceWedding }) {
  if (w.groups.length === 0) {
    return (
      <div style={{ marginBottom: 40 }}>
        <div className="sg-pagehead"><h1>Finance · {w.title}</h1></div>
        <div className="sg-empty">
          <div className="sg-empty__title">No families yet</div>
          <p>
            This wedding has no families yet. Finance tracking attributes each cost to a family (bride’s family, groom’s
            family, the couple), so those need to exist first — once they’re in place, expenses and the net position appear here.
          </p>
          <Link href="/host/groups" className="sg-btn sg-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', marginTop: 12 }}>Set up families &amp; admins →</Link>
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 44 }}>
      <div className="sg-pagehead">
        <h1>Finance · {w.title}</h1>
        <p>Cash-basis paid expenses, split across families, with per-currency net positions. Amounts are actual payments only.</p>
      </div>

      <section className="sg-section">
        <h2>Net position by family &amp; currency</h2>
        <NetPosition w={w} />
      </section>

      <section className="sg-section">
        <h2>Expenses ({w.expenses.length})</h2>
        <div className="sg-tablewrap">
          <table className="sg-table">
            <thead><tr>
              <th>Expense</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Paid on</th>
              <th>Paid by</th>
              <th>Split</th>
              <th></th>
            </tr></thead>
            <tbody>
              {w.expenses.length === 0
                ? <tr><td colSpan={6}><span className="sg-muted">No expenses yet — add the first below.</span></td></tr>
                : w.expenses.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.description}</strong>{e.category ? <span className="sg-muted"> · {e.category}</span> : null}{e.note ? <div className="sg-muted" style={{ fontSize: 12 }}>{e.note}</div> : null}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(e.amount, e.currency)}</td>
                    <td>{e.paidAt}</td>
                    <td>{e.paidByGroupName ?? '—'}</td>
                    <td>{e.allocations.map((a) => `${a.groupName ?? '—'} ${money(a.amount, e.currency)}`).join('; ')}</td>
                    <td>
                      <details>
                        <summary style={{ cursor: 'pointer', color: 'var(--maroon)', fontSize: 13 }}>Edit</summary>
                        <div style={{ marginTop: 10, minWidth: 320 }}><ExpenseForm w={w} e={e} /></div>
                        <form action={deleteExpense} style={{ marginTop: 8 }}>
                          <input type="hidden" name="weddingId" value={w.weddingId} />
                          <input type="hidden" name="expenseId" value={e.id} />
                          <button type="submit" className="sg-btn sg-btn--danger sg-btn--sm">Delete expense</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sg-section">
        <h2>Add an expense</h2>
        <ExpenseForm w={w} />
      </section>
    </div>
  );
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireVerifiedUser('/host/finance');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: FinanceWedding[];
  try {
    weddings = await getFinanceData(db);
  } catch {
    return (
      <main className="sg-host">
        <div className="sg-host-shell">
          <HostNav current="finance" />
          <div className="sg-pagehead"><h1>Finance</h1></div>
          <div className="sg-banner is-err">We couldn’t load this page right now. Please refresh in a moment.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNav current="finance" />

        {banner ? <div className={"sg-banner " + (banner.kind === 'ok' ? 'is-ok' : 'is-err')}>{banner.text}</div> : null}

        {weddings.length === 0 ? (
          <>
            <div className="sg-pagehead"><h1>Finance</h1></div>
            <div className="sg-empty"><p>You’re not set as an organizer for any wedding yet, so there’s nothing to track here.</p></div>
          </>
        ) : (
          weddings.map((w) => <WeddingFinance key={w.weddingId} w={w} />)
        )}
      </div>
    </main>
  );
}
