import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getFinanceData, type FinanceWedding, type FinanceExpense, type FinanceGroup } from '@/lib/data/finance';
import { addExpense, updateExpense, deleteExpense } from './actions';

export const dynamic = 'force-dynamic';

const CURRENCIES = ['INR', 'USD'];

const wrap = { padding: 24, maxWidth: 1040, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#111' } as const;
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e5e5', fontSize: 12, color: '#555' } as const;
const td = { padding: '8px 10px', borderBottom: '1px solid #eee', fontSize: 14, verticalAlign: 'top' } as const;
const input = { padding: '7px 9px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, width: '100%', boxSizing: 'border-box' } as const;
const label = { fontSize: 12, color: '#666', display: 'block', marginBottom: 3 } as const;
const btn = { padding: '6px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6, border: '1px solid #ccc', background: '#fff' } as const;
const btnPrimary = { ...btn, background: '#1d3b5c', color: '#fff', border: '1px solid #1d3b5c' } as const;
const card = { background: '#f7f9fb', border: '1px solid #e3ebf2', borderRadius: 10, padding: 16, marginBottom: 20 } as const;
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const;

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
    <form action={action} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
      <input type="hidden" name="weddingId" value={w.weddingId} />
      {editing ? <input type="hidden" name="expenseId" value={e!.id} /> : null}
      <div style={{ gridColumn: '1 / -1' }}><label style={label}>Description *</label><input style={input} name="description" required defaultValue={e?.description ?? ''} placeholder="e.g. Decor deposit" /></div>
      <div><label style={label}>Category</label><input style={input} name="category" defaultValue={e?.category ?? ''} placeholder="venue, catering, decor…" /></div>
      <div><label style={label}>Paid on *</label><input style={input} type="date" name="paidAt" required defaultValue={e?.paidAt ?? ''} /></div>
      <div><label style={label}>Amount *</label><input style={input} type="number" step="0.01" min="0" name="amount" required defaultValue={e?.amount ?? ''} /></div>
      <div>
        <label style={label}>Currency</label>
        <select style={input as React.CSSProperties} name="currency" defaultValue={e?.currency ?? 'INR'}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={label}>Paid by *</label>
        <select style={input as React.CSSProperties} name="paidBy" required defaultValue={e?.paidByGroupId ?? ''}>
          <option value="" disabled>— choose family —</option>
          {w.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1', border: '1px solid #e4e9ef', borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>Responsible split — enter a value for each family that shares this cost:</div>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <label style={{ marginRight: 14 }}><input type="radio" name="basis" value="percent" defaultChecked={!editing} /> Percentages (total 100%)</label>
          <label><input type="radio" name="basis" value="amount" defaultChecked={editing} /> Fixed amounts (total the amount)</label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {w.groups.map((g) => (
            <div key={g.id}>
              <label style={label}>{g.name}</label>
              <input style={input} type="number" step="0.01" min="0" name={`alloc_${g.id}`} defaultValue={allocFor(g.id)} placeholder="0" />
            </div>
          ))}
        </div>
      </div>
      <div style={{ gridColumn: '1 / -1' }}><label style={label}>Note</label><input style={input} name="note" defaultValue={e?.note ?? ''} placeholder="optional" /></div>
      <div style={{ gridColumn: '1 / -1' }}><button type="submit" style={btnPrimary}>{editing ? 'Save changes' : 'Add expense'}</button></div>
    </form>
  );
}

function NetPosition({ w }: { w: FinanceWedding }) {
  if (w.netByCurrency.length === 0) return <p style={{ color: '#999', fontSize: 14 }}>No expenses recorded yet.</p>;
  return (
    <>
      {w.netByCurrency.map((block) => (
        <div key={block.currency} style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>{block.currency}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Family</th><th style={{ ...th, ...num }}>Paid</th><th style={{ ...th, ...num }}>Allocated</th><th style={{ ...th, ...num }}>Net position</th>
            </tr></thead>
            <tbody>
              {block.rows.map((r) => (
                <tr key={r.groupId}>
                  <td style={td}>{r.groupName ?? '—'}</td>
                  <td style={{ ...td, ...num }}>{money(r.paid, block.currency)}</td>
                  <td style={{ ...td, ...num }}>{money(r.allocated, block.currency)}</td>
                  <td style={{ ...td, ...num, fontWeight: 700, color: r.net > 0 ? '#137333' : r.net < 0 ? '#b00020' : '#555' }}>
                    {r.net > 0 ? `ahead ${money(r.net, block.currency)}` : r.net < 0 ? `behind ${money(-r.net, block.currency)}` : 'even'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p style={{ color: '#777', fontSize: 12.5, marginTop: 4 }}>
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
        <h1 style={{ margin: '0 0 8px' }}>Finance · {w.title}</h1>
        <div style={card}>
          <p style={{ margin: 0, color: '#555' }}>
            This wedding has no family groups yet. Finance tracking attributes each cost to a family (bride’s family, groom’s
            family, the couple), so those groups need to exist first. Setting up family groups is a separate step from this
            screen — once they’re in place, expenses and the net position appear here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 44 }}>
      <h1 style={{ margin: '0 0 2px' }}>Finance · {w.title}</h1>
      <p style={{ color: '#777', margin: '0 0 16px', fontSize: 14 }}>Cash-basis paid expenses, split across families, with per-currency net positions. Amounts are actual payments only.</p>

      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Net position by family &amp; currency</h2>
      <NetPosition w={w} />

      <h2 style={{ fontSize: 16, margin: '24px 0 8px' }}>Expenses ({w.expenses.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr>
          <th style={th}>Expense</th><th style={{ ...th, ...num }}>Amount</th><th style={th}>Paid on</th><th style={th}>Paid by</th><th style={th}>Split</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {w.expenses.length === 0
            ? <tr><td style={td} colSpan={6}><span style={{ color: '#999' }}>No expenses yet — add the first below.</span></td></tr>
            : w.expenses.map((e) => (
              <tr key={e.id}>
                <td style={td}><strong>{e.description}</strong>{e.category ? <span style={{ color: '#999' }}> · {e.category}</span> : null}{e.note ? <div style={{ color: '#999', fontSize: 12 }}>{e.note}</div> : null}</td>
                <td style={{ ...td, ...num }}>{money(e.amount, e.currency)}</td>
                <td style={td}>{e.paidAt}</td>
                <td style={td}>{e.paidByGroupName ?? '—'}</td>
                <td style={td}>{e.allocations.map((a) => `${a.groupName ?? '—'} ${money(a.amount, e.currency)}`).join('; ')}</td>
                <td style={td}>
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#1d3b5c' }}>Edit</summary>
                    <div style={{ marginTop: 10, minWidth: 320 }}><ExpenseForm w={w} e={e} /></div>
                    <form action={deleteExpense} style={{ marginTop: 8 }}>
                      <input type="hidden" name="weddingId" value={w.weddingId} />
                      <input type="hidden" name="expenseId" value={e.id} />
                      <button type="submit" style={{ ...btn, color: '#b00020', borderColor: '#e6b4ba', fontSize: 12, padding: '4px 10px' }}>Delete expense</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <section style={card}>
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Add an expense</h2>
        <ExpenseForm w={w} />
      </section>
    </div>
  );
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireVerifiedUser('/host/finance');
  const sp = await searchParams;
  const banner = sp.ok ? MESSAGES[sp.ok] : sp.err ? MESSAGES[sp.err] : undefined;

  const db = await pageClient();
  let weddings: FinanceWedding[];
  try {
    weddings = await getFinanceData(db);
  } catch {
    return (
      <main style={wrap}>
        <h1>Finance</h1>
        <p style={{ color: '#b00020' }}>We couldn’t load this page right now. Please refresh in a moment.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
          <Link href="/host" style={{ fontSize: 13, color: '#1d3b5c' }}>← Dashboard</Link>
          <Link href="/host/manage" style={{ fontSize: 13, color: '#1d3b5c' }}>Guests</Link>
          <Link href="/host/setup" style={{ fontSize: 13, color: '#1d3b5c' }}>Venues &amp; events</Link>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#777' }}>{user.email}</span>
          <form action="/auth/signout" method="post"><button type="submit" style={btn}>Sign out</button></form>
        </div>
      </header>

      {banner ? (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 18, fontSize: 14,
          background: banner.kind === 'ok' ? '#e6f4ea' : '#fce8e6', color: banner.kind === 'ok' ? '#137333' : '#b00020',
          border: `1px solid ${banner.kind === 'ok' ? '#b7e1c1' : '#f2c2c2'}` }}>{banner.text}</div>
      ) : null}

      {weddings.length === 0 ? (
        <div>
          <h1>Finance</h1>
          <p style={{ color: '#555' }}>You’re not set as an organizer for any wedding yet, so there’s nothing to track here.</p>
        </div>
      ) : (
        weddings.map((w) => <WeddingFinance key={w.weddingId} w={w} />)
      )}
    </main>
  );
}
