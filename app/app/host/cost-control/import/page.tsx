import { requireVerifiedUser } from '@/lib/auth/session';
import { getCostControl } from '@/lib/data/cost-control';
import { COST_IMPORT_COLUMNS,getCostImportBatches } from '@/lib/data/cost-import';
import { pageClient } from '@/lib/supabase/pageClient';
import { HostNav } from '../../HostNav';
import { CostControlNav } from '../CostControlNav';
import { stageCostImport } from './actions';
import { ImportPreview } from './ImportPreview';

export const dynamic='force-dynamic';

export default async function CostImportPage({searchParams}:{searchParams:Promise<{ok?:string;err?:string;batch?:string}>}){
  await requireVerifiedUser('/host/cost-control/import');
  const sp=await searchParams;
  let failed=false;
  let weddings:Awaited<ReturnType<typeof getCostControl>>=[];
  let batches:Awaited<ReturnType<typeof getCostImportBatches>>=[];
  try{
    const db=await pageClient();
    weddings=await getCostControl(db);
    batches=await getCostImportBatches(db,weddings.map((wedding)=>wedding.weddingId));
  }catch(error){console.error('[sangam cost-import] load',error);failed=true;}

  return <main className="sg-host"><div className="sg-host-shell"><HostNav current="cost-control"/><CostControlNav current="import"/>
    {sp.ok?<div className="sg-banner is-ok">Import workflow updated.</div>:sp.err||failed?<div className="sg-banner is-err">We couldn’t complete that import action. No partial official records were written.</div>:null}
    <div className="sg-pagehead"><h1>Import agreed lines</h1><p>Stage and review an external agreed line list before it crosses into official Cost Control. Only title, centre, amount, tax and scope are accepted.</p></div>
    <div className="sg-boundary-note">No ceiling, family opinion, contribution, funding source or payer field crosses this boundary. An import creates draft estimates only.</div>
    {weddings.map((wedding)=><div key={wedding.weddingId}>
      <div className="sg-sectionhead sg-importheading"><div><span className="sg-section__kicker">{wedding.title}</span><h2>Staging area</h2></div></div>
      {wedding.isEventManager?<section className="sg-section"><h2>Stage a CSV</h2><p className="sg-muted">Use the exact header below. Cost-centre and match-item names are exact matches; anything uncertain remains unresolved for manual review.</p>
        <code className="sg-codeblock">{COST_IMPORT_COLUMNS.join(',')}</code>
        <form action={stageCostImport} className="sg-importform"><input type="hidden" name="weddingId" value={wedding.weddingId}/>
          <label className="sg-field"><span className="sg-label">Import key *</span><input className="sg-input" name="importKey" required maxLength={128} placeholder="agreed-register-v1"/></label>
          <label className="sg-field"><span className="sg-label">Source name *</span><input className="sg-input" name="sourceName" required maxLength={200} placeholder="Agreed wedding register"/></label>
          <label className="sg-field"><span className="sg-label">CSV file</span><input className="sg-input" type="file" name="file" accept=".csv,text/csv"/></label>
          <label className="sg-field sg-field--wide"><span className="sg-label">Or paste CSV</span><textarea className="sg-textarea" name="csv" rows={8} placeholder={`${COST_IMPORT_COLUMNS.join(',')}\nline-1,Headline act,3900000,INR,18,Entertainment,Headline act,Performance,Hotel stay`}/></label>
          <button className="sg-btn sg-btn--primary">Validate and stage</button>
        </form></section>:<div className="sg-boundary-note">Read-only for your cost-approver role. Event managers stage, resolve and commit imports.</div>}
      {batches.filter((batch)=>batch.weddingId===wedding.weddingId).map((batch)=><ImportPreview key={batch.id} wedding={wedding} batch={batch}/>)}
      {!batches.some((batch)=>batch.weddingId===wedding.weddingId)?<div className="sg-empty"><div className="sg-empty__title">No staged imports</div><p>An event manager can stage the first agreed line list above.</p></div>:null}
    </div>)}
    {!weddings.length&&!failed?<div className="sg-empty"><div className="sg-empty__title">No Cost Control role</div><p>Your account is not appointed as an event manager or cost approver.</p></div>:null}
  </div></main>;
}
