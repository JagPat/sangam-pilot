import type { CostControlWedding } from '@/lib/data/cost-control';
import type { CostImportBatch } from '@/lib/data/cost-import';
import { commitCostImport,confirmCostImportMatches,resolveCostImportLine } from './actions';

const money=(value:number,currency:string)=>new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{
  style:'currency',currency,maximumFractionDigits:2,
}).format(value);

export function ImportPreview({wedding,batch}:{wedding:CostControlWedding;batch:CostImportBatch}){
  const centres=new Map(wedding.centres.map((centre)=>[centre.id,centre.name]));
  const items=new Map(wedding.items.map((item)=>[item.id,item]));
  const matched=batch.lines.filter((line)=>line.resolution==='matched');
  const creates=batch.lines.filter((line)=>line.resolution==='create');
  const unresolved=batch.lines.filter((line)=>line.resolution==='unresolved');
  const unconfirmed=matched.filter((line)=>!line.matchConfirmed);
  const staged=batch.state==='staged';
  const ready=staged&&!unresolved.length&&!unconfirmed.length;
  return <section className="sg-importbatch" id={`batch-${batch.id}`}>
    <header><div><span className="sg-section__kicker">Staged batch</span><h2>{batch.sourceName}</h2>
      <p>Import key <code>{batch.importKey}</code> · {batch.state}</p></div><span className={`sg-badge ${staged?'is-wait':'is-on'}`}>{batch.lines.length} lines</span></header>
    <div className="sg-importstats">
      <article><strong>{matched.length}</strong><span>Matched lines</span><small>new draft on existing item</small></article>
      <article><strong>{creates.length}</strong><span>New cost items</span><small>item plus draft estimate</small></article>
      <article><strong>{unresolved.length}</strong><span>Unresolved lines</span><small>blocks the whole commit</small></article>
      <article><strong>{unconfirmed.length}</strong><span>Matches to confirm</span><small>explicit operator review</small></article>
    </div>
    <div className="sg-tablewrap"><table className="sg-table"><thead><tr><th>Agreed line</th><th>Target</th><th>Amount</th><th>Will be written as</th></tr></thead><tbody>
      {batch.lines.map((line)=><tr key={line.id}><td><strong>{line.title}</strong><br/><span className="sg-muted">{line.sourceLineId}</span></td>
        <td>{line.centreId?centres.get(line.centreId)??'Unknown centre':'— not set —'}</td>
        <td>{money(line.subtotal,line.currency)}<br/><span className="sg-muted">{line.taxRate}% tax</span></td>
        <td>{line.committedEstimateId?<span className="sg-badge is-on">Draft created</span>
          :line.resolution==='matched'?<><strong>New draft on {items.get(line.matchedItemId??'')?.title??'existing item'}</strong><br/>
            <span className={`sg-badge ${line.matchConfirmed?'is-on':'is-wait'}`}>{line.matchConfirmed?'Match confirmed':'Confirm match'}</span></>
          :line.resolution==='create'?<><strong>Create item + draft</strong><br/><span className="sg-muted">No item match requested.</span></>
          :<><strong className="sg-error">Blocked — target required</strong>
            {wedding.isEventManager&&staged?<form action={resolveCostImportLine} className="sg-resolveform">
              <input type="hidden" name="weddingId" value={wedding.weddingId}/><input type="hidden" name="batchId" value={batch.id}/>
              <input type="hidden" name="lineId" value={line.id}/>
              <select className="sg-select" name="target" required defaultValue="">
                <option value="" disabled>Choose target…</option>
                <optgroup label="Create a new item in">
                  {wedding.centres.map((centre)=><option key={`create:${centre.id}`} value={`create:${centre.id}`}>{centre.name}</option>)}
                </optgroup>
                <optgroup label="Match an existing item">
                  {wedding.items.map((item)=><option key={`match:${item.id}`} value={`match:${item.id}`}>{item.centreName} · {item.title}</option>)}
                </optgroup>
              </select><button className="sg-btn sg-btn--sm">Resolve</button>
            </form>:null}</>}</td></tr>)}
    </tbody></table></div>
    {wedding.isCostApprover&&!wedding.isEventManager&&staged?<div className="sg-boundary-note">Read-only for cost approvers. The event manager resolves and commits this batch; you receive its draft estimates only after they are submitted for decision.</div>:null}
    {wedding.isEventManager&&staged?<div className="sg-importactions">
      {unconfirmed.length?<form action={confirmCostImportMatches}>
        <input type="hidden" name="weddingId" value={wedding.weddingId}/><input type="hidden" name="batchId" value={batch.id}/>
        {unconfirmed.map((line)=><input key={line.id} type="hidden" name="lineId" value={line.id}/>)}
        <button className="sg-btn">Confirm {unconfirmed.length} proposed match{unconfirmed.length===1?'':'es'}</button>
      </form>:null}
      <form action={commitCostImport}><input type="hidden" name="weddingId" value={wedding.weddingId}/><input type="hidden" name="batchId" value={batch.id}/>
        <button className="sg-btn sg-btn--primary" disabled={!ready}>{ready?`Create ${batch.lines.length} draft estimate${batch.lines.length===1?'':'s'}`:`Commit blocked · ${unresolved.length+unconfirmed.length} open`}</button>
      </form>
      <p>Nothing is submitted for approval by this import. A second commit is a database-enforced no-op.</p>
    </div>:null}
  </section>;
}
