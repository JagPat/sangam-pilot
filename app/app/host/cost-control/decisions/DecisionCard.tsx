import type { CostControlDecisionItem } from '@/lib/data/cost-control';
import { beginEstimateReview,decideEstimate } from '../actions';

const money=(value:number,currency:string)=>new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{
  style:'currency',currency,maximumFractionDigits:2,
}).format(value);

function Delta({value,currency,empty}:{value:number|null;currency:string;empty:string}){
  if(value===null) return <><strong>—</strong><span>{empty}</span></>;
  const prefix=value>0?'+':'';
  return <><strong className={value>0?'is-exposure':value<0?'is-saving':undefined}>{prefix}{money(value,currency)}</strong>
    <span>{value===0?'unchanged':value>0?'higher':'lower'}</span></>;
}

export function DecisionCard({decision}:{decision:CostControlDecisionItem}){
  const estimate=decision.estimate;
  return <article className="sg-decisioncard">
    <header><div><span className="sg-section__kicker">{decision.centreName}</span><h2>{decision.itemTitle}</h2>
      <p>Version {estimate.version} · {estimate.taxRate}% tax · {estimate.state.replace('_',' ')}</p></div>
      <strong className="sg-decisioncard__amount">{money(estimate.total,estimate.currency)}</strong></header>
    <div className="sg-decisioncontext">
      <div><span>{decision.approvedBaseline?'Against approved version':'First approval on this item'}</span>
        <Delta value={decision.changeFromApproved} currency={estimate.currency} empty="No approved figure to compare"/></div>
      <div><span>{decision.previousVersion?'Since previous version':'No earlier version'}</span>
        <Delta value={decision.changeFromPrevious} currency={estimate.currency} empty="This is the first submission"/></div>
      <div><span>Item exposure</span><strong className={decision.exposure?'is-exposure':undefined}>{decision.exposure?`+${money(decision.exposure,estimate.currency)}`:'Within approval'}</strong>
        <small>approved commitment against approved estimate</small></div>
    </div>
    <div className="sg-scopegrid"><div><span>Included</span><p>{estimate.scopeIncluded||'No included scope recorded.'}</p></div>
      <div><span>Excluded</span><p>{estimate.scopeExcluded||'No exclusions recorded.'}</p></div></div>
    {estimate.decisionDue?<p className="sg-decisiondue">Decision due {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium'}).format(new Date(estimate.decisionDue))}</p>:null}
  </article>;
}

export function DecisionActions({weddingId,decision}:{weddingId:string;decision:CostControlDecisionItem}){
  if(decision.estimate.state==='submitted') return <form action={beginEstimateReview}>
    <input type="hidden" name="weddingId" value={weddingId}/><input type="hidden" name="estimateId" value={decision.estimate.id}/>
    <input type="hidden" name="returnTo" value="/host/cost-control/decisions"/>
    <button className="sg-btn sg-btn--primary">Start review</button>
  </form>;
  return <form action={decideEstimate} className="sg-decisionform">
    <input type="hidden" name="weddingId" value={weddingId}/><input type="hidden" name="estimateId" value={decision.estimate.id}/>
    <input type="hidden" name="returnTo" value="/host/cost-control/decisions"/>
    <label className="sg-field"><span className="sg-label">Decision</span><select className="sg-select" name="decision">
      <option value="approved">Approve</option><option value="revision_required">Request revision</option><option value="rejected">Reject</option>
    </select></label>
    <label className="sg-field"><span className="sg-label">Written reason *</span><textarea className="sg-textarea" name="reason" required maxLength={2000}/></label>
    <button className="sg-btn sg-btn--primary">Record decision</button>
  </form>;
}
