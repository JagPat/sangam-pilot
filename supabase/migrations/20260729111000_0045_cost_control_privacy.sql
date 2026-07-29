-- Keep Cost Control estimate-first: reject only explicit private-finance labels, never infer sensitive meaning.

create or replace function app.assert_official_cost_text(p_value text) returns void
language plpgsql stable set search_path=app,public as $$
begin
  if p_value ~* '\m(bank[[:space:]]+(account|a/c)|ifsc|((credit|debit)[[:space:]]+)?card[[:space:]]+(number|no\.?)|source[[:space:]]+of[[:space:]]+funds|funding[[:space:]]+sources?|contributions?|family[[:space:]]+settlements?|private[[:space:]]+settlements?|(available[[:space:]]+)?family[[:space:]]+balance|payer[[:space:]]+family|paid[[:space:]]+by[[:space:]]+family|account[[:space:]]+(number|no\.?))\M' then
    raise exception 'private-finance labels are not allowed in Cost Control' using errcode='22023';
  end if;
end $$;

alter table app.cost_item
  add constraint cost_item_title_length check(length(title)<=200) not valid,
  add constraint cost_item_description_length check(length(description)<=2000) not valid;
alter table app.cost_estimate_version
  add constraint cost_estimate_scope_included_length check(length(scope_included)<=2000) not valid,
  add constraint cost_estimate_scope_excluded_length check(length(scope_excluded)<=2000) not valid,
  add constraint cost_estimate_unit_length check(length(unit)<=100) not valid,
  add constraint cost_estimate_alternative_length check(length(alternative)<=2000) not valid,
  add constraint cost_estimate_saving_proposal_length check(length(saving_proposal)<=2000) not valid,
  add constraint cost_estimate_dependency_length check(length(dependency)<=2000) not valid,
  add constraint cost_estimate_remarks_length check(length(remarks)<=2000) not valid;
alter table app.cost_decision add constraint cost_decision_reason_length check(length(reason)<=2000) not valid;
alter table app.cost_commitment
  add constraint cost_commitment_quote_reference_length check(length(quote_reference)<=500) not valid,
  add constraint cost_commitment_decision_reason_length check(length(decision_reason)<=2000) not valid;
alter table app.cost_invoice
  add constraint cost_invoice_reference_length check(length(invoice_reference)<=500) not valid,
  add constraint cost_invoice_verification_reason_length check(length(verification_reason)<=2000) not valid;
alter table app.cost_payment
  add constraint cost_payment_reference_length check(length(official_reference)<=500) not valid,
  add constraint cost_payment_void_reason_length check(length(void_reason)<=2000) not valid;

create or replace function app.create_cost_item(
  p_wedding uuid,p_centre uuid,p_title text,p_description text,
  p_event uuid,p_engagement uuid,p_decision_due timestamptz
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid;
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_title); perform app.assert_official_cost_text(p_description);
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'title is required'; end if;
  insert into app.cost_item(wedding_id,cost_centre_id,event_instance_id,engagement_id,title,description,decision_due_at,created_by_account_id)
  values(p_wedding,p_centre,p_event,p_engagement,trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_decision_due,v_actor)
  returning id into v_item;
  return v_item;
end $$;

create or replace function app.save_cost_estimate_draft(
  p_wedding uuid,p_item uuid,p_estimate uuid,p_input jsonb
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare
  v_actor uuid:=app.current_account_id(); v_id uuid; v_version integer; v_origin app.cost_estimate_origin;
  v_subtotal numeric; v_tax numeric; v_currency text; v_suggested uuid;
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_input->>'scope_included');
  perform app.assert_official_cost_text(p_input->>'scope_excluded');
  perform app.assert_official_cost_text(p_input->>'unit');
  perform app.assert_official_cost_text(p_input->>'alternative');
  perform app.assert_official_cost_text(p_input->>'saving_proposal');
  perform app.assert_official_cost_text(p_input->>'dependency');
  perform app.assert_official_cost_text(p_input->>'remarks');
  if not exists(select 1 from app.cost_item where wedding_id=p_wedding and id=p_item) then raise exception 'unknown cost item'; end if;
  v_subtotal:=round((p_input->>'subtotal')::numeric,2);
  v_tax:=coalesce((p_input->>'tax_rate')::numeric,0);
  v_currency:=upper(trim(coalesce(p_input->>'currency_code','')));
  v_suggested:=nullif(p_input->>'suggested_engagement_id','')::uuid;
  if v_subtotal<0 or v_tax<0 or v_tax>100 or v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid estimate amount, tax, or currency'; end if;
  if p_estimate is null then
    perform 1 from app.cost_item where wedding_id=p_wedding and id=p_item for update;
    select coalesce(max(version_number),0)+1 into v_version from app.cost_estimate_version where wedding_id=p_wedding and cost_item_id=p_item;
    v_origin:=case when app.is_event_manager(p_wedding) then 'event_manager_submission'::app.cost_estimate_origin else 'approver_entry'::app.cost_estimate_origin end;
    insert into app.cost_estimate_version(wedding_id,cost_item_id,version_number,origin,scope_included,scope_excluded,quantity,unit,unit_rate,subtotal,tax_rate,currency_code,suggested_engagement_id,alternative,saving_proposal,dependency,remarks,decision_due_at,created_by_account_id)
    values(p_wedding,p_item,v_version,v_origin,nullif(p_input->>'scope_included',''),nullif(p_input->>'scope_excluded',''),nullif(p_input->>'quantity','')::numeric,nullif(p_input->>'unit',''),nullif(p_input->>'unit_rate','')::numeric,v_subtotal,v_tax,v_currency,v_suggested,nullif(p_input->>'alternative',''),nullif(p_input->>'saving_proposal',''),nullif(p_input->>'dependency',''),nullif(p_input->>'remarks',''),nullif(p_input->>'decision_due_at','')::timestamptz,v_actor)
    returning id into v_id;
  else
    update app.cost_estimate_version set
      scope_included=nullif(p_input->>'scope_included',''),scope_excluded=nullif(p_input->>'scope_excluded',''),quantity=nullif(p_input->>'quantity','')::numeric,unit=nullif(p_input->>'unit',''),unit_rate=nullif(p_input->>'unit_rate','')::numeric,subtotal=v_subtotal,tax_rate=v_tax,currency_code=v_currency,suggested_engagement_id=v_suggested,alternative=nullif(p_input->>'alternative',''),saving_proposal=nullif(p_input->>'saving_proposal',''),dependency=nullif(p_input->>'dependency',''),remarks=nullif(p_input->>'remarks',''),decision_due_at=nullif(p_input->>'decision_due_at','')::timestamptz
     where wedding_id=p_wedding and id=p_estimate and cost_item_id=p_item and state='draft' and created_by_account_id=v_actor
     returning id into v_id;
    if v_id is null then raise exception 'estimate is not an editable draft' using errcode='SA020'; end if;
  end if;
  return v_id;
end $$;

create or replace function app.decide_cost_estimate(
  p_wedding uuid,p_estimate uuid,p_decision text,p_reason text,p_expected_state text
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid; v_submitter uuid; v_previous app.cost_estimate_state; v_result app.cost_estimate_state;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_reason);
  if p_decision not in ('approved','revision_required','rejected') then raise exception 'invalid decision'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'decision reason is required'; end if;
  select cost_item_id,submitted_by_account_id,state into v_item,v_submitter,v_previous from app.cost_estimate_version where wedding_id=p_wedding and id=p_estimate for update;
  if v_item is null then raise exception 'unknown estimate'; end if;
  if v_previous::text<>p_expected_state or v_previous<>'under_review' then raise exception 'stale estimate decision' using errcode='SA023'; end if;
  if v_submitter=v_actor then raise exception 'submitter cannot decide their own estimate' using errcode='42501'; end if;
  v_result:=p_decision::app.cost_estimate_state;
  if v_result='approved' then update app.cost_estimate_version set state='superseded' where wedding_id=p_wedding and cost_item_id=v_item and state='approved' and id<>p_estimate; end if;
  update app.cost_estimate_version set state=v_result where wedding_id=p_wedding and id=p_estimate;
  update app.cost_item set lifecycle_state=case when v_result='approved' then 'approved' else 'planning' end,updated_at=now() where wedding_id=p_wedding and id=v_item;
  insert into app.cost_decision(wedding_id,cost_item_id,estimate_version_id,decision,actor_account_id,previous_state,resulting_state,reason)
  values(p_wedding,v_item,p_estimate,p_decision,v_actor,v_previous,v_result,trim(p_reason));
end $$;

create or replace function app.propose_cost_commitment(
  p_wedding uuid,p_item uuid,p_estimate uuid,p_engagement uuid,p_quote_reference text,p_commitment_date date
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_id uuid; v_subtotal numeric; v_tax numeric; v_currency char(3);
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_quote_reference);
  select subtotal,tax_amount,currency_code into v_subtotal,v_tax,v_currency from app.cost_estimate_version where wedding_id=p_wedding and id=p_estimate and cost_item_id=p_item and state='approved';
  if not found then raise exception 'an approved estimate for this item is required' using errcode='SA030'; end if;
  insert into app.cost_commitment(wedding_id,cost_item_id,approved_estimate_id,engagement_id,quote_reference,subtotal,tax_amount,currency_code,commitment_date,proposed_by_account_id)
  values(p_wedding,p_item,p_estimate,p_engagement,nullif(trim(coalesce(p_quote_reference,'')),''),v_subtotal,v_tax,v_currency,p_commitment_date,v_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function app.decide_cost_commitment(
  p_wedding uuid,p_commitment uuid,p_decision text,p_reason text
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid; v_proposer uuid;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_reason);
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'decision reason is required'; end if;
  select cost_item_id,proposed_by_account_id into v_item,v_proposer from app.cost_commitment where wedding_id=p_wedding and id=p_commitment and state='proposed' for update;
  if not found then raise exception 'commitment is not pending' using errcode='SA031'; end if;
  if v_proposer=v_actor then raise exception 'proposer cannot approve their own commitment' using errcode='42501'; end if;
  update app.cost_commitment set state=p_decision::app.cost_commitment_state,approved_by_account_id=v_actor,decision_reason=trim(p_reason),decided_at=now() where wedding_id=p_wedding and id=p_commitment;
  if p_decision='approved' then update app.cost_commitment set state='superseded' where wedding_id=p_wedding and cost_item_id=v_item and state='approved' and id<>p_commitment; update app.cost_item set lifecycle_state='committed',updated_at=now() where wedding_id=p_wedding and id=v_item; end if;
end $$;

create or replace function app.record_cost_invoice(
  p_wedding uuid,p_item uuid,p_commitment uuid,p_reference text,p_subtotal numeric,p_tax_rate numeric,p_currency text,p_due_date date
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_id uuid; v_currency text:=upper(trim(coalesce(p_currency,'')));
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_reference);
  if nullif(trim(coalesce(p_reference,'')),'') is null or p_subtotal<0 or p_tax_rate not between 0 and 100 or v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid invoice details'; end if;
  if p_commitment is not null and not exists(select 1 from app.cost_commitment where wedding_id=p_wedding and id=p_commitment and cost_item_id=p_item and state='approved') then raise exception 'invoice commitment is not approved' using errcode='SA032'; end if;
  if not exists(select 1 from app.cost_item where wedding_id=p_wedding and id=p_item) then raise exception 'unknown cost item'; end if;
  insert into app.cost_invoice(wedding_id,cost_item_id,commitment_id,invoice_reference,subtotal,tax_rate,currency_code,due_date,received_by_account_id)
  values(p_wedding,p_item,p_commitment,trim(p_reference),round(p_subtotal,2),p_tax_rate,v_currency,p_due_date,v_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function app.verify_cost_invoice(p_wedding uuid,p_invoice uuid,p_reason text) returns void
language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid; v_receiver uuid;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_reason);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'verification reason is required'; end if;
  select cost_item_id,received_by_account_id into v_item,v_receiver from app.cost_invoice where wedding_id=p_wedding and id=p_invoice and state='received' for update;
  if not found then raise exception 'invoice is not awaiting verification' using errcode='SA033'; end if;
  if v_receiver=v_actor then raise exception 'receiver cannot verify their own invoice' using errcode='42501'; end if;
  update app.cost_invoice set state='verified',verified_by_account_id=v_actor,verification_reason=trim(p_reason),verified_at=now() where wedding_id=p_wedding and id=p_invoice;
  update app.cost_item set lifecycle_state='invoiced',updated_at=now() where wedding_id=p_wedding and id=v_item;
end $$;

create or replace function app.record_cost_payment(
  p_wedding uuid,p_invoice uuid,p_amount numeric,p_paid_on date,p_method text,p_reference text
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_id uuid; v_total numeric; v_paid numeric; v_state app.cost_invoice_state;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_reference);
  if p_amount is null or p_amount<=0 or p_paid_on is null or p_method not in ('bank_transfer','card','cash','cheque','other') then raise exception 'invalid payment status details'; end if;
  select total,state into v_total,v_state from app.cost_invoice where wedding_id=p_wedding and id=p_invoice for update;
  if not found or v_state not in ('verified','part_paid') then raise exception 'invoice must be verified before payment' using errcode='SA034'; end if;
  select coalesce(sum(amount),0) into v_paid from app.cost_payment where wedding_id=p_wedding and invoice_id=p_invoice and voided_at is null;
  if v_paid+round(p_amount,2)>v_total then raise exception 'payment total exceeds verified invoice' using errcode='23514'; end if;
  insert into app.cost_payment(wedding_id,invoice_id,amount,paid_on,method,official_reference,recorded_by_account_id)
  values(p_wedding,p_invoice,round(p_amount,2),p_paid_on,p_method::app.cost_payment_method,nullif(trim(coalesce(p_reference,'')),''),v_actor) returning id into v_id;
  update app.cost_invoice set state=(case when v_paid+round(p_amount,2)=v_total then 'paid' else 'part_paid' end)::app.cost_invoice_state where wedding_id=p_wedding and id=p_invoice;
  return v_id;
end $$;

create or replace function app.void_cost_payment(p_wedding uuid,p_payment uuid,p_reason text) returns void
language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_invoice uuid; v_total numeric; v_paid numeric;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  perform app.assert_official_cost_text(p_reason);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'void reason is required'; end if;
  update app.cost_payment set voided_at=now(),voided_by_account_id=v_actor,void_reason=trim(p_reason) where wedding_id=p_wedding and id=p_payment and voided_at is null returning invoice_id into v_invoice;
  if not found then raise exception 'payment is not active' using errcode='SA035'; end if;
  select total into v_total from app.cost_invoice where wedding_id=p_wedding and id=v_invoice for update;
  select coalesce(sum(amount),0) into v_paid from app.cost_payment where wedding_id=p_wedding and invoice_id=v_invoice and voided_at is null;
  update app.cost_invoice set state=(case when v_paid=0 then 'verified' when v_paid<v_total then 'part_paid' else 'paid' end)::app.cost_invoice_state where wedding_id=p_wedding and id=v_invoice;
end $$;

revoke execute on function app.assert_official_cost_text(text) from public,anon,authenticated;
grant execute on function app.assert_official_cost_text(text) to service_role;
