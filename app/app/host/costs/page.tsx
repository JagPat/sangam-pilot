import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { getOperationalFinance,type OperationalFinanceWedding,type OperationalCost } from '@/lib/data/finance-operations';
import { HostNav } from '../HostNav';
import { cancelCost,saveCost } from './actions';

export const dynamic='force-dynamic';
const money=(n:number,c:string)=>new Intl.NumberFormat(c==='INR'?'en-IN':'en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(n);
const statusLabel=(s:string)=>s==='funded'?'Funded':s==='funds_needed'?'Funds needed':'Not assessed';

function CostForm({w,c}:{w:OperationalFinanceWedding;c?:OperationalCost}){
  return <form action={saveCost} style={{display:'grid',gap:12}}>
    <input type="hidden" name="weddingId" value={w.weddingId}/>{c?<input type="hidden" name="costId" value={c.id}/>:null}
    <div className="sg-formrow">
      <label className="sg-field"><span className="sg-label">Description *</span><input className="sg-input" name="description" required defaultValue={c?.description}/></label>
      <label className="sg-field"><span className="sg-label">Category</span><input className="sg-input" name="category" defaultValue={c?.category??'misc'}/></label>
      <label className="sg-field"><span className="sg-label">Amount *</span><input className="sg-input" name="amount" type="number" min="0.01" step="0.01" required defaultValue={c?.amount}/></label>
      <label className="sg-field"><span className="sg-label">Currency</span><select className="sg-select" name="currency" defaultValue={c?.currency??'INR'}><option>INR</option><option>USD</option></select></label>
    </div>
    <div className="sg-formrow">
      <label className="sg-field"><span className="sg-label">Due date</span><input className="sg-input" name="dueDate" type="date" defaultValue={c?.dueDate??''}/></label>
      <label className="sg-field"><span className="sg-label">Payment status</span><select className="sg-select" name="paymentStatus" defaultValue={c?.paymentStatus??'planned'}>{['planned','due','part_paid','paid','cancelled'].map((s)=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></label>
      <label className="sg-field"><span className="sg-label">Paid on</span><input className="sg-input" name="paidAt" type="date" defaultValue={c?.paidAt??''}/></label>
      <label className="sg-field"><span className="sg-label">Operational note</span><input className="sg-input" name="note" defaultValue={c?.note??''}/></label>
    </div>
    <div><button className="sg-btn sg-btn--primary" type="submit">{c?'Save cost':'Add cost'}</button></div>
  </form>;
}

function WeddingCosts({w}:{w:OperationalFinanceWedding}){
  return <div style={{marginBottom:44}}><div className="sg-pagehead"><h1>Costs · {w.title}</h1><p>Operational commitments and payment status. Family contributions, allocations, and balances are deliberately hidden.</p></div>
    <section className="sg-section"><h2>Funding status</h2>{w.funding.length?<div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{w.funding.map((s)=><span className={'sg-badge '+(s.status==='funded'?'is-on':s.status==='funds_needed'?'is-wait':'is-off')} key={s.currency}>{s.currency}: {statusLabel(s.status)}</span>)}</div>:<p className="sg-muted">Not assessed. A finance administrator can publish “funded” or “funds needed”; no balance amount is shown.</p>}</section>
    <section className="sg-section"><h2>Operational costs ({w.costs.length})</h2><div className="sg-tablewrap"><table className="sg-table"><thead><tr><th>Cost</th><th>Due</th><th>Status</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr></thead><tbody>{w.costs.length?w.costs.map((c)=><tr key={c.id}><td><strong>{c.description}</strong><div className="sg-muted">{c.category}{c.note?` · ${c.note}`:''}</div></td><td>{c.dueDate??'—'}</td><td><span className="sg-badge is-off">{c.paymentStatus.replace('_',' ')}</span></td><td style={{textAlign:'right'}}>{money(c.amount,c.currency)}</td><td><details><summary style={{cursor:'pointer'}}>Edit</summary><div style={{minWidth:320,marginTop:10}}><CostForm w={w} c={c}/><form action={cancelCost} style={{marginTop:8}}><input type="hidden" name="weddingId" value={w.weddingId}/><input type="hidden" name="costId" value={c.id}/><button className="sg-btn sg-btn--danger sg-btn--sm">Cancel cost</button></form></div></details></td></tr>):<tr><td colSpan={5} className="sg-muted">No costs recorded.</td></tr>}</tbody></table></div></section>
    <section className="sg-section"><h2>Add a cost</h2><CostForm w={w}/></section>
  </div>;
}

export default async function CostsPage({searchParams}:{searchParams:Promise<{ok?:string;err?:string}>}){
  await requireVerifiedUser('/host/costs'); const sp=await searchParams;
  let weddings:OperationalFinanceWedding[]=[]; let failed=false;
  try{ weddings=await getOperationalFinance(await pageClient()); }catch{ failed=true; }
  return <main className="sg-host"><div className="sg-host-shell"><HostNav current="costs"/>{sp.ok?<div className="sg-banner is-ok">Saved.</div>:sp.err||failed?<div className="sg-banner is-err">We couldn’t save or load costs. Check the fields and try again.</div>:null}{weddings.length?weddings.map((w)=><WeddingCosts key={w.weddingId} w={w}/>):<div className="sg-pagehead"><h1>Costs</h1><p>You don’t have event-manager cost access for a wedding.</p></div>}</div></main>;
}
