'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

const value=(fd:FormData,key:string)=>String(fd.get(key)??'').trim();
const fail=()=>redirect('/host/costs?err=save');
const done=()=>{ revalidatePath('/host/costs'); redirect('/host/costs?ok=1'); };

export async function saveCost(fd:FormData):Promise<void>{
  const wedding=value(fd,'weddingId'),cost=value(fd,'costId'),description=value(fd,'description');
  const amount=Number(value(fd,'amount')),currency=value(fd,'currency')||'INR';
  if(!wedding||!description||!Number.isFinite(amount)||amount<=0) fail();
  const args={p_wedding:wedding,p_description:description,p_category:value(fd,'category')||'misc',p_amount:amount,p_currency:currency,p_due_date:value(fd,'dueDate')||null,p_payment_status:value(fd,'paymentStatus')||'planned',p_paid_at:value(fd,'paidAt')||null,p_note:value(fd,'note')||null};
  try{
    const app=(await serverClientRW()).schema('app');
    const result=cost ? await app.rpc('manager_update_cost',{...args,p_cost:cost}) : await app.rpc('manager_add_cost',args);
    if(result.error) throw result.error;
  }catch(error){ console.error('[sangam costs] save',error); fail(); }
  done();
}

export async function cancelCost(fd:FormData):Promise<void>{
  try{
    const app=(await serverClientRW()).schema('app');
    const {error}=await app.rpc('manager_cancel_cost',{p_wedding:value(fd,'weddingId'),p_cost:value(fd,'costId')});
    if(error) throw error;
  }catch(error){ console.error('[sangam costs] cancel',error); fail(); }
  done();
}
