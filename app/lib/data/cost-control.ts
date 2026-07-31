import type { AppSupabaseClient } from '../supabase/clients';

type Wedding={id:string;title:string};
type Centre={id:string;wedding_id:string;name:string;sort_order:number};
type Item={id:string;wedding_id:string;cost_centre_id:string;title:string;description:string|null;lifecycle_state:string;decision_due_at:string|null};
type Estimate={id:string;wedding_id:string;cost_item_id:string;version_number:number;total:number;subtotal:number;tax_rate:number;currency_code:string;state:string;scope_included:string|null;scope_excluded:string|null;remarks:string|null;decision_due_at:string|null;created_by_account_id:string};
type Commitment={id:string;wedding_id:string;cost_item_id:string;approved_estimate_id:string;quote_reference:string|null;total:number;currency_code:string;commitment_date:string|null;state:string};
type Invoice={id:string;wedding_id:string;cost_item_id:string;commitment_id:string|null;invoice_reference:string;subtotal:number;tax_rate:number;total:number;currency_code:string;due_date:string|null;state:string};
type Payment={id:string;wedding_id:string;invoice_id:string;amount:number;paid_on:string;method:string;official_reference:string|null;voided_at:string|null};
type Summary={wedding_id:string;currency_code:string;approved_estimate_total:number;committed_total:number;invoiced_total:number;paid_total:number};

export type CostControlEstimate={id:string;version:number;subtotal:number;taxRate:number;total:number;currency:string;state:string;scopeIncluded:string|null;scopeExcluded:string|null;remarks:string|null;decisionDue:string|null;canEditDraft:boolean};
export type CostControlCommitment={id:string;estimateId:string;reference:string|null;total:number;currency:string;date:string|null;state:string};
export type CostControlInvoice={id:string;commitmentId:string|null;reference:string;subtotal:number;taxRate:number;total:number;currency:string;dueDate:string|null;state:string;payments:CostControlPayment[]};
export type CostControlPayment={id:string;amount:number;paidOn:string;method:string;reference:string|null;voided:boolean};
export type CostControlItem={id:string;centreId:string;centreName:string;title:string;description:string|null;state:string;decisionDue:string|null;estimates:CostControlEstimate[];commitments:CostControlCommitment[];invoices:CostControlInvoice[]};
export type CostControlWedding={weddingId:string;title:string;isEventManager:boolean;isCostApprover:boolean;centres:{id:string;name:string}[];items:CostControlItem[];summary:{currency:string;approved:number;committed:number;invoiced:number;paid:number}[]};
export type CostControlCentrePosition={
  centreId:string;centreName:string;currency:string;approved:number;committed:number;exposure:number;
  exposedItems:number;invoiced:number;paid:number;
};
export type CostControlDashboard={
  officialPosition:CostControlWedding['summary'];
  attention:{awaitingDecisions:number;exposedItems:number;unestimatedItems:number;unverifiedInvoices:number};
  centres:CostControlCentrePosition[];
};

export function getEstimateDraftControls(estimates:Pick<CostControlEstimate,'id'|'state'|'canEditDraft'>[]):{showCreateDraft:boolean;createDraftLabel:'Create estimate draft'|'Create a revised estimate'|null}{
  if(estimates.some((estimate)=>estimate.state==='draft')) return {showCreateDraft:false,createDraftLabel:null};
  return {showCreateDraft:true,createDraftLabel:estimates.length?'Create a revised estimate':'Create estimate draft'};
}

export function deriveCostControlDashboard(wedding:CostControlWedding):CostControlDashboard{
  const centres=new Map<string,CostControlCentrePosition>();
  let awaitingDecisions=0;
  let exposedItems=0;
  let unestimatedItems=0;
  let unverifiedInvoices=0;

  for(const item of wedding.items){
    awaitingDecisions+=item.estimates.filter((estimate)=>estimate.state==='submitted'||estimate.state==='under_review').length;
    if(!item.estimates.length) unestimatedItems+=1;
    unverifiedInvoices+=item.invoices.filter((invoice)=>invoice.state==='received').length;

    const currencies=new Set([
      ...item.estimates.map((estimate)=>estimate.currency),
      ...item.commitments.map((commitment)=>commitment.currency),
      ...item.invoices.map((invoice)=>invoice.currency),
    ]);
    for(const currency of currencies){
      const approved=item.estimates.find((estimate)=>estimate.state==='approved'&&estimate.currency===currency)?.total??0;
      const committed=item.commitments.find((commitment)=>commitment.state==='approved'&&commitment.currency===currency)?.total??0;
      const exposure=Math.max(committed-approved,0);
      const invoiced=item.invoices.filter((invoice)=>invoice.currency===currency&&invoice.state!=='void').reduce((sum,invoice)=>sum+invoice.total,0);
      const paid=item.invoices.filter((invoice)=>invoice.currency===currency).flatMap((invoice)=>invoice.payments)
        .filter((payment)=>!payment.voided).reduce((sum,payment)=>sum+payment.amount,0);
      const key=`${item.centreId}:${currency}`;
      const current=centres.get(key)??{
        centreId:item.centreId,centreName:item.centreName,currency,approved:0,committed:0,exposure:0,
        exposedItems:0,invoiced:0,paid:0,
      };
      current.approved+=approved;
      current.committed+=committed;
      current.exposure+=exposure;
      current.exposedItems+=exposure>0?1:0;
      current.invoiced+=invoiced;
      current.paid+=paid;
      centres.set(key,current);
      if(exposure>0) exposedItems+=1;
    }
  }

  return {
    officialPosition:wedding.summary,
    attention:{awaitingDecisions,exposedItems,unestimatedItems,unverifiedInvoices},
    centres:[...centres.values()]
      .filter((row)=>row.approved||row.committed||row.invoiced||row.paid)
      .sort((a,b)=>b.exposure-a.exposure||a.centreName.localeCompare(b.centreName)||a.currency.localeCompare(b.currency)),
  };
}

export function mapCostControlWedding(
  wedding:Wedding,roles:string[],centres:Centre[],items:Item[],estimates:Estimate[],commitments:Commitment[],
  invoices:Invoice[],payments:Payment[],summary:Summary[],currentAccountId:string,
):CostControlWedding{
  const ownCentres=centres.filter((c)=>c.wedding_id===wedding.id).sort((a,b)=>a.sort_order-b.sort_order);
  const centreNames=new Map(ownCentres.map((c)=>[c.id,c.name]));
  const ownInvoices=invoices.filter((i)=>i.wedding_id===wedding.id);
  return {
    weddingId:wedding.id,title:wedding.title,isEventManager:roles.includes('event_manager'),isCostApprover:roles.includes('cost_approver'),
    centres:ownCentres.map((c)=>({id:c.id,name:c.name})),
    items:items.filter((i)=>i.wedding_id===wedding.id).map((i)=>({
      id:i.id,centreId:i.cost_centre_id,centreName:centreNames.get(i.cost_centre_id)??'Other',title:i.title,
      description:i.description,state:i.lifecycle_state,decisionDue:i.decision_due_at,
      estimates:estimates.filter((e)=>e.wedding_id===wedding.id&&e.cost_item_id===i.id).map((e)=>({id:e.id,version:e.version_number,subtotal:Number(e.subtotal),taxRate:Number(e.tax_rate),total:Number(e.total),currency:e.currency_code,state:e.state,scopeIncluded:e.scope_included,scopeExcluded:e.scope_excluded,remarks:e.remarks,decisionDue:e.decision_due_at,canEditDraft:e.state==='draft'&&e.created_by_account_id===currentAccountId})).sort((a,b)=>b.version-a.version),
      commitments:commitments.filter((c)=>c.wedding_id===wedding.id&&c.cost_item_id===i.id).map((c)=>({id:c.id,estimateId:c.approved_estimate_id,reference:c.quote_reference,total:Number(c.total),currency:c.currency_code,date:c.commitment_date,state:c.state})),
      invoices:ownInvoices.filter((v)=>v.cost_item_id===i.id).map((v)=>({id:v.id,commitmentId:v.commitment_id,reference:v.invoice_reference,subtotal:Number(v.subtotal),taxRate:Number(v.tax_rate),total:Number(v.total),currency:v.currency_code,dueDate:v.due_date,state:v.state,
        payments:payments.filter((p)=>p.wedding_id===wedding.id&&p.invoice_id===v.id).map((p)=>({id:p.id,amount:Number(p.amount),paidOn:p.paid_on,method:p.method,reference:p.official_reference,voided:p.voided_at!==null}))})),
    })),
    summary:summary.filter((s)=>s.wedding_id===wedding.id).map((s)=>({currency:s.currency_code,approved:Number(s.approved_estimate_total),committed:Number(s.committed_total),invoiced:Number(s.invoiced_total),paid:Number(s.paid_total)})),
  };
}

export async function getCostControl(db:AppSupabaseClient):Promise<CostControlWedding[]>{
  const app=db.schema('app');
  const {data:accountId,error:accountError}=await app.rpc('current_account_id');
  if(accountError) throw accountError;
  if(!accountId) return [];
  const rolesResult=await app.from('operator_role').select('wedding_id,role').eq('account_id',accountId);
  if(rolesResult.error) throw rolesResult.error;
  const relevant=(rolesResult.data??[]).filter((r)=>r.role==='event_manager'||r.role==='cost_approver');
  const ids=[...new Set(relevant.map((r)=>r.wedding_id))];
  if(!ids.length) return [];
  const [weddings,centres,items,estimates,commitments,invoices,payments,summary]=await Promise.all([
    app.from('wedding').select('id,title').in('id',ids),
    app.from('cost_centre').select('id,wedding_id,name,sort_order').in('wedding_id',ids),
    app.from('cost_item').select('id,wedding_id,cost_centre_id,title,description,lifecycle_state,decision_due_at').in('wedding_id',ids),
    app.from('cost_estimate_version').select('id,wedding_id,cost_item_id,version_number,total,subtotal,tax_rate,currency_code,state,scope_included,scope_excluded,remarks,decision_due_at,created_by_account_id').in('wedding_id',ids),
    app.from('cost_commitment').select('id,wedding_id,cost_item_id,approved_estimate_id,quote_reference,total,currency_code,commitment_date,state').in('wedding_id',ids),
    app.from('cost_invoice').select('id,wedding_id,cost_item_id,commitment_id,invoice_reference,subtotal,tax_rate,total,currency_code,due_date,state').in('wedding_id',ids),
    app.from('cost_payment').select('id,wedding_id,invoice_id,amount,paid_on,method,official_reference,voided_at').in('wedding_id',ids),
    app.from('cost_control_summary').select('*').in('wedding_id',ids),
  ]);
  for(const result of [weddings,centres,items,estimates,commitments,invoices,payments,summary]) if(result.error) throw result.error;
  return (weddings.data??[]).map((w)=>mapCostControlWedding(w,relevant.filter((r)=>r.wedding_id===w.id).map((r)=>r.role),
    centres.data??[],items.data??[],estimates.data??[],commitments.data??[],invoices.data??[],payments.data??[],summary.data??[],accountId));
}
