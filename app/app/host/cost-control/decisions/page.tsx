import { requireVerifiedUser } from '@/lib/auth/session';
import { deriveDecisionQueue,getCostControl } from '@/lib/data/cost-control';
import { pageClient } from '@/lib/supabase/pageClient';
import { HostNav } from '../../HostNav';
import { CostControlNav } from '../CostControlNav';
import { DecisionActions,DecisionCard } from './DecisionCard';

export const dynamic='force-dynamic';

export default async function CostDecisionsPage({searchParams}:{searchParams:Promise<{ok?:string;err?:string}>}){
  await requireVerifiedUser('/host/cost-control/decisions');
  const sp=await searchParams;
  let failed=false;
  let weddings:Awaited<ReturnType<typeof getCostControl>>=[];
  try{weddings=await getCostControl(await pageClient());}
  catch(error){console.error('[sangam cost-decisions] load',error);failed=true;}

  return <main className="sg-host"><div className="sg-host-shell"><HostNav current="cost-control"/><CostControlNav current="decisions"/>
    {sp.ok?<div className="sg-banner is-ok">Decision workflow updated.</div>:sp.err||failed?<div className="sg-banner is-err">We couldn’t complete that decision. Refresh the queue and try again.</div>:null}
    <div className="sg-pagehead"><h1>Decisions</h1><p>Official scope, price and version context only. Family affordability, targets, opinions and payer information are deliberately absent.</p></div>
    {weddings.map((wedding)=>{
      const queue=deriveDecisionQueue(wedding);
      return <section key={wedding.weddingId} className="sg-decisionlist">
        <div className="sg-sectionhead"><div><span className="sg-section__kicker">{wedding.title}</span>
          <h2>{wedding.isCostApprover?'Decisions waiting on you':'Estimates you submitted'}</h2></div><span className="sg-badge is-wait">{queue.length} open</span></div>
        {queue.length?queue.map((decision)=><div key={decision.estimate.id}><DecisionCard decision={decision}/>
          {wedding.isCostApprover?<div className="sg-decisionactions"><DecisionActions weddingId={wedding.weddingId} decision={decision}/></div>:null}</div>)
          :<div className="sg-empty"><div className="sg-empty__title">No estimates are waiting</div><p>The queue is clear for this wedding.</p></div>}
      </section>;
    })}
    {!weddings.length&&!failed?<div className="sg-empty"><div className="sg-empty__title">No Cost Control role</div><p>Your account is not appointed as an event manager or cost approver.</p></div>:null}
  </div></main>;
}
