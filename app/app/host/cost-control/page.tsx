import { requireVerifiedUser } from '@/lib/auth/session';
import { pageClient } from '@/lib/supabase/pageClient';
import { deriveCostControlDashboard,getCostControl,getEstimateDraftControls,type CostControlWedding,type CostControlItem } from '@/lib/data/cost-control';
import { HostNav } from '../HostNav';
import { addCostItem,decideCommitment,initializeCostControl,proposeCommitment,recordInvoice,recordPayment,saveEstimate,submitEstimate,verifyInvoice,voidPayment } from './actions';
import { CostControlNav } from './CostControlNav';

export const dynamic='force-dynamic';
const money=(n:number,c:string)=>new Intl.NumberFormat(c==='INR'?'en-IN':'en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(n);
const Hidden=({w,item}:{w:string;item?:string})=><><input type="hidden" name="weddingId" value={w}/>{item?<input type="hidden" name="itemId" value={item}/>:null}</>;

function EstimateForm({w,item,estimate}:{w:string;item:string;estimate?:CostControlItem['estimates'][number]}){return <form action={saveEstimate} className="sg-formrow"><Hidden w={w} item={item}/>{estimate?<input type="hidden" name="estimateId" value={estimate.id}/>:null}
  <label className="sg-field"><span className="sg-label">Estimate *</span><input className="sg-input" type="number" min="0" step="0.01" name="subtotal" required defaultValue={estimate?.subtotal}/></label>
  <label className="sg-field"><span className="sg-label">Tax %</span><input className="sg-input" type="number" min="0" max="100" step="0.01" name="taxRate" defaultValue={estimate?.taxRate??0}/></label>
  <label className="sg-field"><span className="sg-label">Currency</span><select className="sg-select" name="currency" defaultValue={estimate?.currency??'INR'}><option>INR</option><option>USD</option></select></label>
  <label className="sg-field"><span className="sg-label">Included scope</span><input className="sg-input" name="scopeIncluded" defaultValue={estimate?.scopeIncluded??''}/></label>
  <label className="sg-field"><span className="sg-label">Excluded scope</span><input className="sg-input" name="scopeExcluded" defaultValue={estimate?.scopeExcluded??''}/></label>
  <label className="sg-field"><span className="sg-label">Decision due</span><input className="sg-input" type="datetime-local" name="decisionDue" defaultValue={estimate?.decisionDue?.slice(0,16)}/></label>
  <label className="sg-field"><span className="sg-label">Remarks</span><input className="sg-input" name="remarks" defaultValue={estimate?.remarks??''}/></label>
  <button className="sg-btn sg-btn--primary" type="submit">Save draft</button></form>;}

function CommitmentDecisionForm({w,id}:{w:string;id:string}){
  return <form action={decideCommitment} className="sg-formrow"><Hidden w={w}/><input type="hidden" name="commitmentId" value={id}/>
    <select className="sg-select" name="decision"><option value="approved">Approve</option><option value="rejected">Reject</option></select>
    <input className="sg-input" name="reason" required placeholder="Decision reason"/><button className="sg-btn sg-btn--primary">Record decision</button></form>;
}

function ItemCard({w,item}:{w:CostControlWedding;item:CostControlItem}){const approved=item.estimates.find((e)=>e.state==='approved'); const approvedCommitments=item.commitments.filter((c)=>c.state==='approved'); const draftControls=getEstimateDraftControls(item.estimates);
  return <section className="sg-section"><h2>{item.title} <span className="sg-badge is-off">{item.state}</span></h2><p className="sg-muted">{item.centreName}{item.description?` · ${item.description}`:''}</p>
    <h3>Estimate versions</h3>{item.estimates.length?<div className="sg-tablewrap"><table className="sg-table"><thead><tr><th>Version</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>{item.estimates.map((e)=><tr key={e.id}><td>v{e.version}</td><td>{e.state.replace('_',' ')}</td><td>{money(e.total,e.currency)}</td><td>
      {e.state==='draft'&&e.canEditDraft?<><details><summary>Edit draft</summary><EstimateForm w={w.weddingId} item={item.id} estimate={e}/></details><form action={submitEstimate}><Hidden w={w.weddingId}/><input type="hidden" name="estimateId" value={e.id}/><button className="sg-btn sg-btn--sm">Submit</button></form></>:null}
      {['submitted','under_review'].includes(e.state)?<a className="sg-textlink" href="/host/cost-control/decisions">Open in Decisions →</a>:null}
    </td></tr>)}</tbody></table></div>:<p className="sg-muted">No estimate yet.</p>}
    {draftControls.showCreateDraft?<details><summary>{draftControls.createDraftLabel}</summary><EstimateForm w={w.weddingId} item={item.id}/></details>:null}
    {approved?<details><summary>Propose official commitment</summary><form action={proposeCommitment} className="sg-formrow"><Hidden w={w.weddingId} item={item.id}/><input type="hidden" name="estimateId" value={approved.id}/><input className="sg-input" name="reference" placeholder="Quote / contract reference"/><input className="sg-input" type="date" name="commitmentDate"/><button className="sg-btn sg-btn--primary">Propose</button></form></details>:null}
    {item.commitments.length?<><h3>Commitments</h3>{item.commitments.map((c)=><div key={c.id} className="sg-callout"><strong>{money(c.total,c.currency)}</strong> · {c.state}{c.reference?` · ${c.reference}`:''}{c.state==='proposed'&&w.isCostApprover?<CommitmentDecisionForm w={w.weddingId} id={c.id}/>:null}</div>)}</>:null}
    <details><summary>Official records (optional)</summary><p className="sg-muted">Invoices and payment status are optional. Estimate and approval tracking remains the default journey.</p>{approvedCommitments.map((c)=><details key={c.id}><summary>Record invoice against {c.reference??'approved commitment'}</summary><form action={recordInvoice} className="sg-formrow"><Hidden w={w.weddingId} item={item.id}/><input type="hidden" name="commitmentId" value={c.id}/><input className="sg-input" name="reference" required placeholder="Invoice reference"/><input className="sg-input" type="number" min="0" step="0.01" name="subtotal" required placeholder="Subtotal"/><input className="sg-input" type="number" min="0" max="100" step="0.01" name="taxRate" defaultValue="0"/><select className="sg-select" name="currency" defaultValue={c.currency}><option>INR</option><option>USD</option></select><input className="sg-input" type="date" name="dueDate"/><button className="sg-btn sg-btn--primary">Record invoice</button></form></details>)}
    {item.invoices.length?<><h3>Official invoices</h3>{item.invoices.map((i)=><div className="sg-callout" key={i.id}><strong>{i.reference}</strong> · {money(i.total,i.currency)} · {i.state.replace('_',' ')}
      {i.state==='received'&&w.isCostApprover?<form action={verifyInvoice} className="sg-formrow"><Hidden w={w.weddingId}/><input type="hidden" name="invoiceId" value={i.id}/><input className="sg-input" name="reason" required placeholder="Verification reason"/><button className="sg-btn sg-btn--primary">Verify</button></form>:null}
      {['verified','part_paid'].includes(i.state)&&w.isCostApprover?<form action={recordPayment} className="sg-formrow"><Hidden w={w.weddingId}/><input type="hidden" name="invoiceId" value={i.id}/><input className="sg-input" type="number" min="0.01" step="0.01" name="amount" required placeholder="Official paid amount"/><input className="sg-input" type="date" name="paidOn" required/><select className="sg-select" name="method"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select><input className="sg-input" name="reference" placeholder="Official reference"/><button className="sg-btn sg-btn--primary">Record payment status</button></form>:null}
      {i.payments.map((p)=><div key={p.id} className="sg-muted">{p.voided?'Voided: ':''}{money(p.amount,i.currency)} · {p.paidOn} · {p.reference??p.method}{!p.voided&&w.isCostApprover?<form action={voidPayment} style={{display:'inline-flex',gap:8,marginLeft:8}}><Hidden w={w.weddingId}/><input type="hidden" name="paymentId" value={p.id}/><input className="sg-input" name="reason" required placeholder="Void reason"/><button className="sg-btn sg-btn--danger sg-btn--sm">Void</button></form>:null}</div>)}
    </div>)}</>:null}</details>
  </section>;
}

function OfficialDashboard({w}:{w:CostControlWedding}){
  const dashboard=deriveCostControlDashboard(w);
  return <><section className="sg-costhero"><div><span className="sg-section__kicker">Official position</span><h2>{w.title}</h2>
    <p>Approved estimates, commitments, vendor invoices and recorded payment status only. No family target, ceiling or funding information.</p></div>
    <div className="sg-costhero__stats">{dashboard.officialPosition.map((s)=><article key={s.currency} className="sg-coststat">
      <span>{s.currency}</span><strong>{money(s.approved,s.currency)}</strong><small>approved</small>
      <div><b>{money(s.committed,s.currency)}</b> committed</div><div>{money(s.invoiced,s.currency)} invoiced</div><div>{money(s.paid,s.currency)} recorded paid</div>
    </article>)}</div></section>
    <section className="sg-section"><div className="sg-sectionhead"><div><span className="sg-section__kicker">Needs attention</span><h2>Official workflow</h2></div><a href="/host/cost-control/decisions" className="sg-textlink">Open decisions →</a></div>
      <div className="sg-attentiongrid">
        <article><strong>{dashboard.attention.awaitingDecisions}</strong><span>Estimates awaiting a decision</span></article>
        <article><strong>{dashboard.attention.exposedItems}</strong><span>Items committed above approval</span></article>
        <article><strong>{dashboard.attention.unestimatedItems}</strong><span>Items with no estimate</span></article>
        <article><strong>{dashboard.attention.unverifiedInvoices}</strong><span>Invoices received, not verified</span></article>
      </div>
    </section>
    {dashboard.centres.length?<section className="sg-section"><div className="sg-sectionhead"><div><span className="sg-section__kicker">Commitment against approval</span><h2>By cost centre</h2></div><span className="sg-muted">Exposure is calculated per item before roll-up.</span></div>
      <div className="sg-tablewrap"><table className="sg-table sg-costtable"><thead><tr><th>Cost centre</th><th>Approved</th><th>Committed</th><th>Exposure</th><th>Invoiced → paid</th></tr></thead><tbody>
        {dashboard.centres.map((row)=><tr key={`${row.centreId}:${row.currency}`}><td><strong>{row.centreName}</strong><br/><span className="sg-muted">{row.currency}</span></td>
          <td>{money(row.approved,row.currency)}</td><td>{money(row.committed,row.currency)}</td>
          <td>{row.exposure?<span className="sg-badge is-wait">+{money(row.exposure,row.currency)} · {row.exposedItems} item{row.exposedItems===1?'':'s'}</span>:<span className="sg-badge is-on">Within approval</span>}</td>
          <td>{money(row.invoiced,row.currency)} → {money(row.paid,row.currency)}</td></tr>)}
      </tbody></table></div>
      <p className="sg-boundary-note">The approved estimate is the only baseline. This view never compares official costs with a family budget or available funds.</p>
    </section>:null}</>;
}

function WeddingCostControl({w}:{w:CostControlWedding}){return <div><div className="sg-pagehead"><h1>Cost Control</h1><p>Manage the wedding’s official cost record as one client unit.</p></div>
  <OfficialDashboard w={w}/>
  {!w.centres.length?<section className="sg-section"><h2>Start Cost Control</h2><p>Load the standard Indian-wedding cost headings. This creates no budget ceiling or family funding record.</p><form action={initializeCostControl}><Hidden w={w.weddingId}/><button className="sg-btn sg-btn--primary">Load standard headings</button></form></section>:<section className="sg-section"><h2>Add a cost item</h2><form action={addCostItem} className="sg-formrow"><Hidden w={w.weddingId}/><select className="sg-select" name="centreId">{w.centres.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input className="sg-input" name="title" required placeholder="Official cost item"/><input className="sg-input" name="description" placeholder="Scope note"/><input className="sg-input" type="date" name="decisionDue"/><button className="sg-btn sg-btn--primary">Add item</button></form></section>}
  {w.items.length?<div className="sg-pagehead sg-pagehead--section"><h1>Cost items</h1><p>Draft, submit and maintain the official records below.</p></div>:null}
  {w.items.map((item)=><ItemCard key={item.id} w={w} item={item}/>)}</div>;}

export default async function CostControlPage({searchParams}:{searchParams:Promise<{ok?:string;err?:string}>}){await requireVerifiedUser('/host/cost-control');const sp=await searchParams;let weddings:CostControlWedding[]=[];let failed=false;try{weddings=await getCostControl(await pageClient());}catch(error){console.error('[sangam cost-control] load',error);failed=true;}
  return <main className="sg-host"><div className="sg-host-shell"><HostNav current="cost-control"/><CostControlNav current="overview"/>{sp.ok?<div className="sg-banner is-ok">Saved.</div>:sp.err||failed?<div className="sg-banner is-err">We couldn’t complete that Cost Control action. Check the details and try again.</div>:null}{weddings.length?weddings.map((w)=><WeddingCostControl key={w.weddingId} w={w}/>):<div className="sg-pagehead"><h1>Cost Control</h1><p>Your account is not appointed as an event manager or cost approver for a wedding.</p></div>}</div></main>;}
