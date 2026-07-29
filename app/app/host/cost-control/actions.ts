'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';
import type { Database } from '@/lib/database.types';
import { validateOfficialCostText } from '@/lib/data/costPrivacy';

type FunctionName=keyof Database['app']['Functions'];
const text=(fd:FormData,key:string)=>String(fd.get(key)??'').trim();
const optional=(fd:FormData,key:string)=>text(fd,key)||null;
const number=(fd:FormData,key:string)=>Number(text(fd,key));
const official=(...values:string[])=>values.every((value)=>validateOfficialCostText(value).ok);
const finish=()=>{revalidatePath('/host/cost-control');redirect('/host/cost-control?ok=1');};
const fail=(code='save'):never=>redirect(`/host/cost-control?err=${encodeURIComponent(code)}`);

async function command(name:FunctionName,args:Record<string,unknown>){
  try{
    const app=(await serverClientRW()).schema('app');
    const {error}=await app.rpc(name,args as never);
    if(error) throw error;
  }catch(error){console.error(`[sangam cost-control] ${name}`,error);fail();}
  finish();
}

export async function initializeCostControl(fd:FormData){await command('initialize_cost_control',{p_wedding:text(fd,'weddingId')});}
export async function addCostItem(fd:FormData){
  if(!text(fd,'weddingId')||!text(fd,'centreId')||!text(fd,'title')) fail('fields');
  if(!official(text(fd,'title'),text(fd,'description'))) fail('privacy');
  await command('create_cost_item',{p_wedding:text(fd,'weddingId'),p_centre:text(fd,'centreId'),p_title:text(fd,'title'),
    p_description:optional(fd,'description'),p_event:null,p_engagement:null,p_decision_due:optional(fd,'decisionDue')});
}
export async function saveEstimate(fd:FormData){
  const subtotal=number(fd,'subtotal'),taxRate=number(fd,'taxRate');
  if(!Number.isFinite(subtotal)||subtotal<0||!Number.isFinite(taxRate)||taxRate<0||taxRate>100) fail('fields');
  if(!official(text(fd,'scopeIncluded'),text(fd,'scopeExcluded'),text(fd,'remarks'))) fail('privacy');
  await command('save_cost_estimate_draft',{p_wedding:text(fd,'weddingId'),p_item:text(fd,'itemId'),p_estimate:optional(fd,'estimateId'),
    p_input:{subtotal,tax_rate:taxRate,currency_code:text(fd,'currency')||'INR',scope_included:optional(fd,'scopeIncluded'),
      scope_excluded:optional(fd,'scopeExcluded'),remarks:optional(fd,'remarks'),decision_due_at:optional(fd,'decisionDue')}});
}
export async function submitEstimate(fd:FormData){await command('submit_cost_estimate',{p_wedding:text(fd,'weddingId'),p_estimate:text(fd,'estimateId')});}
export async function beginEstimateReview(fd:FormData){await command('begin_cost_review',{p_wedding:text(fd,'weddingId'),p_estimate:text(fd,'estimateId')});}
export async function decideEstimate(fd:FormData){if(!official(text(fd,'reason'))) fail('privacy');await command('decide_cost_estimate',{p_wedding:text(fd,'weddingId'),p_estimate:text(fd,'estimateId'),p_decision:text(fd,'decision'),p_reason:text(fd,'reason'),p_expected_state:'under_review'});}
export async function proposeCommitment(fd:FormData){if(!official(text(fd,'reference'))) fail('privacy');await command('propose_cost_commitment',{p_wedding:text(fd,'weddingId'),p_item:text(fd,'itemId'),p_estimate:text(fd,'estimateId'),p_engagement:null,p_quote_reference:optional(fd,'reference'),p_commitment_date:optional(fd,'commitmentDate')});}
export async function decideCommitment(fd:FormData){if(!official(text(fd,'reason'))) fail('privacy');await command('decide_cost_commitment',{p_wedding:text(fd,'weddingId'),p_commitment:text(fd,'commitmentId'),p_decision:text(fd,'decision'),p_reason:text(fd,'reason')});}
export async function recordInvoice(fd:FormData){
  const subtotal=number(fd,'subtotal'),taxRate=number(fd,'taxRate');
  if(!Number.isFinite(subtotal)||subtotal<0||!Number.isFinite(taxRate)) fail('fields');
  if(!official(text(fd,'reference'))) fail('privacy');
  await command('record_cost_invoice',{p_wedding:text(fd,'weddingId'),p_item:text(fd,'itemId'),p_commitment:optional(fd,'commitmentId'),
    p_reference:text(fd,'reference'),p_subtotal:subtotal,p_tax_rate:taxRate,p_currency:text(fd,'currency')||'INR',p_due_date:optional(fd,'dueDate')});
}
export async function verifyInvoice(fd:FormData){if(!official(text(fd,'reason'))) fail('privacy');await command('verify_cost_invoice',{p_wedding:text(fd,'weddingId'),p_invoice:text(fd,'invoiceId'),p_reason:text(fd,'reason')});}
export async function recordPayment(fd:FormData){
  const amount=number(fd,'amount'); if(!Number.isFinite(amount)||amount<=0) fail('fields');
  if(!official(text(fd,'reference'))) fail('privacy');
  await command('record_cost_payment',{p_wedding:text(fd,'weddingId'),p_invoice:text(fd,'invoiceId'),p_amount:amount,
    p_paid_on:text(fd,'paidOn'),p_method:text(fd,'method'),p_reference:optional(fd,'reference')});
}
export async function voidPayment(fd:FormData){if(!official(text(fd,'reason'))) fail('privacy');await command('void_cost_payment',{p_wedding:text(fd,'weddingId'),p_payment:text(fd,'paymentId'),p_reason:text(fd,'reason')});}
