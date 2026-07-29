-- Official commitments, invoices and payment-status records. No family funding or contribution data.

create type app.cost_commitment_state as enum ('proposed','approved','rejected','cancelled','superseded');
create type app.cost_invoice_state as enum ('received','verified','disputed','part_paid','paid','void');
create type app.cost_payment_method as enum ('bank_transfer','card','cash','cheque','other');

create table app.cost_commitment(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  cost_item_id uuid not null,
  approved_estimate_id uuid not null,
  engagement_id uuid,
  quote_reference text,
  subtotal numeric(14,2) not null check(subtotal>=0),
  tax_amount numeric(14,2) not null check(tax_amount>=0),
  total numeric(14,2) generated always as (subtotal+tax_amount) stored,
  currency_code char(3) not null check(currency_code ~ '^[A-Z]{3}$'),
  commitment_date date,
  state app.cost_commitment_state not null default 'proposed',
  proposed_by_account_id uuid not null references app.account(id),
  approved_by_account_id uuid references app.account(id),
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(wedding_id,id),
  foreign key(wedding_id,cost_item_id) references app.cost_item(wedding_id,id) on delete cascade,
  foreign key(wedding_id,approved_estimate_id) references app.cost_estimate_version(wedding_id,id),
  foreign key(wedding_id,engagement_id) references app.engagement(wedding_id,id)
);

create table app.cost_invoice(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  cost_item_id uuid not null,
  commitment_id uuid,
  invoice_reference text not null check(length(trim(invoice_reference))>0),
  subtotal numeric(14,2) not null check(subtotal>=0),
  tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(14,2) generated always as (round(subtotal*tax_rate/100,2)) stored,
  total numeric(14,2) generated always as (round(subtotal+(subtotal*tax_rate/100),2)) stored,
  currency_code char(3) not null check(currency_code ~ '^[A-Z]{3}$'),
  due_date date,
  state app.cost_invoice_state not null default 'received',
  received_by_account_id uuid not null references app.account(id),
  verified_by_account_id uuid references app.account(id),
  verification_reason text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique(wedding_id,id),
  unique(wedding_id,invoice_reference),
  foreign key(wedding_id,cost_item_id) references app.cost_item(wedding_id,id) on delete cascade,
  foreign key(wedding_id,commitment_id) references app.cost_commitment(wedding_id,id)
);

create table app.cost_payment(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  invoice_id uuid not null,
  amount numeric(14,2) not null check(amount>0),
  paid_on date not null,
  method app.cost_payment_method not null,
  official_reference text,
  recorded_by_account_id uuid not null references app.account(id),
  voided_at timestamptz,
  voided_by_account_id uuid references app.account(id),
  void_reason text,
  created_at timestamptz not null default now(),
  unique(wedding_id,id),
  foreign key(wedding_id,invoice_id) references app.cost_invoice(wedding_id,id) on delete cascade,
  constraint cost_payment_void_shape check(
    (voided_at is null and voided_by_account_id is null and void_reason is null)
    or (voided_at is not null and voided_by_account_id is not null and nullif(trim(coalesce(void_reason,'')),'') is not null)
  )
);

alter table app.cost_commitment enable row level security;
alter table app.cost_invoice enable row level security;
alter table app.cost_payment enable row level security;
create policy cost_commitment_authorized_read on app.cost_commitment for select using(app.can_access_cost_control(wedding_id));
create policy cost_invoice_authorized_read on app.cost_invoice for select using(app.can_access_cost_control(wedding_id));
create policy cost_payment_authorized_read on app.cost_payment for select using(app.can_access_cost_control(wedding_id));

create or replace function app.propose_cost_commitment(
  p_wedding uuid,p_item uuid,p_estimate uuid,p_engagement uuid,p_quote_reference text,p_commitment_date date
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_id uuid; v_subtotal numeric; v_tax numeric; v_currency char(3);
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  select subtotal,tax_amount,currency_code into v_subtotal,v_tax,v_currency
    from app.cost_estimate_version
   where wedding_id=p_wedding and id=p_estimate and cost_item_id=p_item and state='approved';
  if not found then raise exception 'an approved estimate for this item is required' using errcode='SA030'; end if;
  insert into app.cost_commitment(wedding_id,cost_item_id,approved_estimate_id,engagement_id,quote_reference,
    subtotal,tax_amount,currency_code,commitment_date,proposed_by_account_id)
  values(p_wedding,p_item,p_estimate,p_engagement,nullif(trim(coalesce(p_quote_reference,'')),''),
    v_subtotal,v_tax,v_currency,p_commitment_date,v_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function app.decide_cost_commitment(
  p_wedding uuid,p_commitment uuid,p_decision text,p_reason text
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid; v_proposer uuid;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'decision reason is required'; end if;
  select cost_item_id,proposed_by_account_id into v_item,v_proposer from app.cost_commitment
    where wedding_id=p_wedding and id=p_commitment and state='proposed' for update;
  if not found then raise exception 'commitment is not pending' using errcode='SA031'; end if;
  if v_proposer=v_actor then raise exception 'proposer cannot approve their own commitment' using errcode='42501'; end if;
  update app.cost_commitment set state=p_decision::app.cost_commitment_state,approved_by_account_id=v_actor,
    decision_reason=trim(p_reason),decided_at=now() where wedding_id=p_wedding and id=p_commitment;
  if p_decision='approved' then
    update app.cost_commitment set state='superseded' where wedding_id=p_wedding and cost_item_id=v_item
      and state='approved' and id<>p_commitment;
    update app.cost_item set lifecycle_state='committed',updated_at=now() where wedding_id=p_wedding and id=v_item;
  end if;
end $$;

create or replace function app.record_cost_invoice(
  p_wedding uuid,p_item uuid,p_commitment uuid,p_reference text,p_subtotal numeric,
  p_tax_rate numeric,p_currency text,p_due_date date
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_id uuid; v_currency text:=upper(trim(coalesce(p_currency,'')));
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_reference,'')),'') is null or p_subtotal<0 or p_tax_rate not between 0 and 100
    or v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid invoice details'; end if;
  if p_commitment is not null and not exists(select 1 from app.cost_commitment where wedding_id=p_wedding
      and id=p_commitment and cost_item_id=p_item and state='approved') then
    raise exception 'invoice commitment is not approved' using errcode='SA032';
  end if;
  if not exists(select 1 from app.cost_item where wedding_id=p_wedding and id=p_item) then raise exception 'unknown cost item'; end if;
  insert into app.cost_invoice(wedding_id,cost_item_id,commitment_id,invoice_reference,subtotal,tax_rate,
    currency_code,due_date,received_by_account_id)
  values(p_wedding,p_item,p_commitment,trim(p_reference),round(p_subtotal,2),p_tax_rate,v_currency,p_due_date,v_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.verify_cost_invoice(p_wedding uuid,p_invoice uuid,p_reason text) returns void
language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid; v_receiver uuid;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'verification reason is required'; end if;
  select cost_item_id,received_by_account_id into v_item,v_receiver from app.cost_invoice
    where wedding_id=p_wedding and id=p_invoice and state='received' for update;
  if not found then raise exception 'invoice is not awaiting verification' using errcode='SA033'; end if;
  if v_receiver=v_actor then raise exception 'receiver cannot verify their own invoice' using errcode='42501'; end if;
  update app.cost_invoice set state='verified',verified_by_account_id=v_actor,verification_reason=trim(p_reason),verified_at=now()
    where wedding_id=p_wedding and id=p_invoice;
  update app.cost_item set lifecycle_state='invoiced',updated_at=now() where wedding_id=p_wedding and id=v_item;
end $$;

create or replace function app.record_cost_payment(
  p_wedding uuid,p_invoice uuid,p_amount numeric,p_paid_on date,p_method text,p_reference text
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_id uuid; v_total numeric; v_paid numeric; v_state app.cost_invoice_state;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  if p_amount is null or p_amount<=0 or p_paid_on is null or p_method not in ('bank_transfer','card','cash','cheque','other')
    then raise exception 'invalid payment status details'; end if;
  select total,state into v_total,v_state from app.cost_invoice where wedding_id=p_wedding and id=p_invoice for update;
  if not found or v_state not in ('verified','part_paid') then raise exception 'invoice must be verified before payment' using errcode='SA034'; end if;
  select coalesce(sum(amount),0) into v_paid from app.cost_payment where wedding_id=p_wedding and invoice_id=p_invoice and voided_at is null;
  if v_paid+round(p_amount,2)>v_total then raise exception 'payment total exceeds verified invoice' using errcode='23514'; end if;
  insert into app.cost_payment(wedding_id,invoice_id,amount,paid_on,method,official_reference,recorded_by_account_id)
  values(p_wedding,p_invoice,round(p_amount,2),p_paid_on,p_method::app.cost_payment_method,
    nullif(trim(coalesce(p_reference,'')),''),v_actor) returning id into v_id;
  update app.cost_invoice set state=(case when v_paid+round(p_amount,2)=v_total then 'paid' else 'part_paid' end)::app.cost_invoice_state
    where wedding_id=p_wedding and id=p_invoice;
  return v_id;
end $$;

create or replace function app.void_cost_payment(p_wedding uuid,p_payment uuid,p_reason text) returns void
language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_invoice uuid; v_total numeric; v_paid numeric;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'void reason is required'; end if;
  update app.cost_payment set voided_at=now(),voided_by_account_id=v_actor,void_reason=trim(p_reason)
    where wedding_id=p_wedding and id=p_payment and voided_at is null returning invoice_id into v_invoice;
  if not found then raise exception 'payment is not active' using errcode='SA035'; end if;
  select total into v_total from app.cost_invoice where wedding_id=p_wedding and id=v_invoice for update;
  select coalesce(sum(amount),0) into v_paid from app.cost_payment where wedding_id=p_wedding and invoice_id=v_invoice and voided_at is null;
  update app.cost_invoice set state=(case when v_paid=0 then 'verified' when v_paid<v_total then 'part_paid' else 'paid' end)::app.cost_invoice_state
    where wedding_id=p_wedding and id=v_invoice;
end $$;

create view app.cost_control_summary with (security_invoker=true) as
with currencies as (
  select wedding_id,currency_code from app.cost_estimate_version where state='approved'
  union select wedding_id,currency_code from app.cost_commitment where state='approved'
  union select wedding_id,currency_code from app.cost_invoice where state not in ('void','disputed')
), estimates as (
  select wedding_id,currency_code,sum(total) total from app.cost_estimate_version where state='approved' group by 1,2
), commitments as (
  select wedding_id,currency_code,sum(total) total from app.cost_commitment where state='approved' group by 1,2
), invoices as (
  select wedding_id,currency_code,sum(total) total from app.cost_invoice where state not in ('void','disputed') group by 1,2
), payments as (
  select p.wedding_id,i.currency_code,sum(p.amount) total from app.cost_payment p join app.cost_invoice i
    on i.wedding_id=p.wedding_id and i.id=p.invoice_id where p.voided_at is null group by 1,2
)
select c.wedding_id,c.currency_code,coalesce(e.total,0)::numeric(14,2) approved_estimate_total,
  coalesce(k.total,0)::numeric(14,2) committed_total,coalesce(i.total,0)::numeric(14,2) invoiced_total,
  coalesce(p.total,0)::numeric(14,2) paid_total
from currencies c left join estimates e using(wedding_id,currency_code)
 left join commitments k using(wedding_id,currency_code)
 left join invoices i using(wedding_id,currency_code)
 left join payments p using(wedding_id,currency_code);

create view app.cost_control_attention with (security_invoker=true) as
select ci.wedding_id,ci.id as cost_item_id,'decision_due'::text attention_kind,ci.decision_due_at due_at,ci.title label
 from app.cost_item ci where ci.decision_due_at<now() and ci.lifecycle_state='planning'
union all
select i.wedding_id,i.cost_item_id,'invoice_due'::text,i.due_date::timestamptz,i.invoice_reference
 from app.cost_invoice i where i.due_date<current_date and i.state in ('verified','part_paid');

grant select on app.cost_commitment,app.cost_invoice,app.cost_payment,app.cost_control_summary,app.cost_control_attention to authenticated,service_role;
revoke insert,update,delete on app.cost_commitment,app.cost_invoice,app.cost_payment from public,anon,authenticated;
grant insert,update,delete on app.cost_commitment,app.cost_invoice,app.cost_payment to service_role;

revoke execute on function app.propose_cost_commitment(uuid,uuid,uuid,uuid,text,date),app.decide_cost_commitment(uuid,uuid,text,text),
  app.record_cost_invoice(uuid,uuid,uuid,text,numeric,numeric,text,date),app.verify_cost_invoice(uuid,uuid,text),
  app.record_cost_payment(uuid,uuid,numeric,date,text,text),app.void_cost_payment(uuid,uuid,text) from public,anon;
grant execute on function app.propose_cost_commitment(uuid,uuid,uuid,uuid,text,date),app.decide_cost_commitment(uuid,uuid,text,text),
  app.record_cost_invoice(uuid,uuid,uuid,text,numeric,numeric,text,date),app.verify_cost_invoice(uuid,uuid,text),
  app.record_cost_payment(uuid,uuid,numeric,date,text,text),app.void_cost_payment(uuid,uuid,text) to authenticated,service_role;
