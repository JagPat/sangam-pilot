import type { AppSupabaseClient } from '../supabase/clients';
import { roleWeddingIds } from './owner';

export type OperationalCost = { id:string; description:string; category:string; amount:number; currency:string; dueDate:string|null; paymentStatus:string; paidAt:string|null; note:string|null };
export type FundingSignal = { currency:string; status:string; updatedAt:string };
export type OperationalFinanceWedding = { weddingId:string; title:string; costs:OperationalCost[]; funding:FundingSignal[] };

export async function getOperationalFinance(db:AppSupabaseClient):Promise<OperationalFinanceWedding[]> {
  const ids=await roleWeddingIds(db,'event_manager');
  if(!ids.length) return [];
  const app=db.schema('app');
  const [weddings,costs,funding]=await Promise.all([
    app.from('wedding').select('id,title').in('id',ids),
    app.from('finance_cost_item').select('id,wedding_id,description,category,amount,currency_code,due_date,payment_status,paid_at,operational_note').in('wedding_id',ids),
    app.from('finance_funding_status').select('wedding_id,currency_code,status,updated_at').in('wedding_id',ids),
  ]);
  for(const result of [weddings,costs,funding]) if(result.error) throw result.error;
  return (weddings.data??[]).map((w)=>({
    weddingId:w.id,title:w.title,
    costs:(costs.data??[]).filter((c)=>c.wedding_id===w.id).map((c)=>({id:c.id,description:c.description,category:c.category,amount:Number(c.amount),currency:c.currency_code,dueDate:c.due_date,paymentStatus:c.payment_status,paidAt:c.paid_at,note:c.operational_note})).sort((a,b)=>(a.dueDate??'9999').localeCompare(b.dueDate??'9999')),
    funding:(funding.data??[]).filter((s)=>s.wedding_id===w.id).map((s)=>({currency:s.currency_code,status:s.status,updatedAt:s.updated_at})).sort((a,b)=>a.currency.localeCompare(b.currency)),
  }));
}
