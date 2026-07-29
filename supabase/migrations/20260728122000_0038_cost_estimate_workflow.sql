-- Immutable estimate versions and independently authorized approval decisions.

create type app.cost_estimate_state as enum
  ('draft','submitted','under_review','revision_required','rejected','approved','superseded');
create type app.cost_estimate_origin as enum
  ('event_manager_submission','approver_entry','import','legacy_import');

create table app.cost_estimate_version(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  cost_item_id uuid not null,
  version_number integer not null check(version_number>0),
  origin app.cost_estimate_origin not null,
  scope_included text,
  scope_excluded text,
  quantity numeric(14,3) check(quantity is null or quantity>0),
  unit text,
  unit_rate numeric(14,2) check(unit_rate is null or unit_rate>=0),
  subtotal numeric(14,2) not null check(subtotal>=0),
  tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(14,2) generated always as (round(subtotal*tax_rate/100,2)) stored,
  total numeric(14,2) generated always as (round(subtotal+(subtotal*tax_rate/100),2)) stored,
  currency_code char(3) not null check(currency_code ~ '^[A-Z]{3}$'),
  suggested_engagement_id uuid,
  alternative text,
  saving_proposal text,
  dependency text,
  remarks text,
  decision_due_at timestamptz,
  state app.cost_estimate_state not null default 'draft',
  created_by_account_id uuid not null references app.account(id),
  submitted_by_account_id uuid references app.account(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique(wedding_id,id),
  unique(wedding_id,cost_item_id,version_number),
  foreign key(wedding_id,cost_item_id) references app.cost_item(wedding_id,id) on delete cascade,
  foreign key(wedding_id,suggested_engagement_id) references app.engagement(wedding_id,id)
);
create unique index cost_estimate_one_approved
  on app.cost_estimate_version(wedding_id,cost_item_id) where state='approved';

create table app.cost_decision(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  cost_item_id uuid not null,
  estimate_version_id uuid not null,
  decision text not null check(decision in ('review_started','approved','revision_required','rejected','approval_withdrawn')),
  actor_account_id uuid not null references app.account(id),
  previous_state app.cost_estimate_state not null,
  resulting_state app.cost_estimate_state not null,
  reason text,
  created_at timestamptz not null default now(),
  unique(wedding_id,id),
  foreign key(wedding_id,cost_item_id) references app.cost_item(wedding_id,id) on delete cascade,
  foreign key(wedding_id,estimate_version_id) references app.cost_estimate_version(wedding_id,id) on delete cascade,
  constraint cost_decision_reason check(decision='review_started' or nullif(trim(coalesce(reason,'')),'') is not null)
);

alter table app.cost_estimate_version enable row level security;
alter table app.cost_decision enable row level security;
create policy cost_estimate_authorized_read on app.cost_estimate_version for select
  using(app.can_access_cost_control(wedding_id));
create policy cost_decision_authorized_read on app.cost_decision for select
  using(app.can_access_cost_control(wedding_id));

create or replace function app.create_cost_item(
  p_wedding uuid,p_centre uuid,p_title text,p_description text,
  p_event uuid,p_engagement uuid,p_decision_due timestamptz
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid;
begin
  if not app.can_access_cost_control(p_wedding) then
    raise exception 'not authorized for Cost Control' using errcode='42501';
  end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'title is required'; end if;
  insert into app.cost_item(
    wedding_id,cost_centre_id,event_instance_id,engagement_id,title,description,
    decision_due_at,created_by_account_id
  ) values(
    p_wedding,p_centre,p_event,p_engagement,trim(p_title),nullif(trim(coalesce(p_description,'')),''),
    p_decision_due,v_actor
  ) returning id into v_item;
  return v_item;
end $$;

create or replace function app.save_cost_estimate_draft(
  p_wedding uuid,p_item uuid,p_estimate uuid,p_input jsonb
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare
  v_actor uuid:=app.current_account_id();
  v_id uuid; v_version integer; v_origin app.cost_estimate_origin;
  v_subtotal numeric; v_tax numeric; v_currency text; v_suggested uuid;
begin
  if not app.can_access_cost_control(p_wedding) then
    raise exception 'not authorized for Cost Control' using errcode='42501';
  end if;
  if not exists(select 1 from app.cost_item where wedding_id=p_wedding and id=p_item) then
    raise exception 'unknown cost item';
  end if;
  v_subtotal:=round((p_input->>'subtotal')::numeric,2);
  v_tax:=coalesce((p_input->>'tax_rate')::numeric,0);
  v_currency:=upper(trim(coalesce(p_input->>'currency_code','')));
  v_suggested:=nullif(p_input->>'suggested_engagement_id','')::uuid;
  if v_subtotal<0 or v_tax<0 or v_tax>100 or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid estimate amount, tax, or currency';
  end if;

  if p_estimate is null then
    perform 1 from app.cost_item where wedding_id=p_wedding and id=p_item for update;
    select coalesce(max(version_number),0)+1 into v_version
      from app.cost_estimate_version where wedding_id=p_wedding and cost_item_id=p_item;
    v_origin:=case when app.is_event_manager(p_wedding) then 'event_manager_submission'::app.cost_estimate_origin
                   else 'approver_entry'::app.cost_estimate_origin end;
    insert into app.cost_estimate_version(
      wedding_id,cost_item_id,version_number,origin,scope_included,scope_excluded,quantity,unit,unit_rate,
      subtotal,tax_rate,currency_code,suggested_engagement_id,alternative,saving_proposal,dependency,remarks,
      decision_due_at,created_by_account_id
    ) values(
      p_wedding,p_item,v_version,v_origin,nullif(p_input->>'scope_included',''),nullif(p_input->>'scope_excluded',''),
      nullif(p_input->>'quantity','')::numeric,nullif(p_input->>'unit',''),nullif(p_input->>'unit_rate','')::numeric,
      v_subtotal,v_tax,v_currency,v_suggested,nullif(p_input->>'alternative',''),nullif(p_input->>'saving_proposal',''),
      nullif(p_input->>'dependency',''),nullif(p_input->>'remarks',''),nullif(p_input->>'decision_due_at','')::timestamptz,v_actor
    ) returning id into v_id;
  else
    update app.cost_estimate_version set
      scope_included=nullif(p_input->>'scope_included',''),scope_excluded=nullif(p_input->>'scope_excluded',''),
      quantity=nullif(p_input->>'quantity','')::numeric,unit=nullif(p_input->>'unit',''),
      unit_rate=nullif(p_input->>'unit_rate','')::numeric,subtotal=v_subtotal,tax_rate=v_tax,currency_code=v_currency,
      suggested_engagement_id=v_suggested,alternative=nullif(p_input->>'alternative',''),
      saving_proposal=nullif(p_input->>'saving_proposal',''),dependency=nullif(p_input->>'dependency',''),
      remarks=nullif(p_input->>'remarks',''),decision_due_at=nullif(p_input->>'decision_due_at','')::timestamptz
     where wedding_id=p_wedding and id=p_estimate and cost_item_id=p_item and state='draft'
       and created_by_account_id=v_actor
     returning id into v_id;
    if v_id is null then raise exception 'estimate is not an editable draft' using errcode='SA020'; end if;
  end if;
  return v_id;
end $$;

create or replace function app.submit_cost_estimate(p_wedding uuid,p_estimate uuid) returns void
language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id();
begin
  if not app.can_access_cost_control(p_wedding) then raise exception 'not authorized for Cost Control' using errcode='42501'; end if;
  update app.cost_estimate_version
     set state='submitted',submitted_by_account_id=v_actor,submitted_at=now()
   where wedding_id=p_wedding and id=p_estimate and state='draft' and created_by_account_id=v_actor;
  if not found then raise exception 'estimate is not your draft' using errcode='SA021'; end if;
end $$;

create or replace function app.begin_cost_review(p_wedding uuid,p_estimate uuid) returns void
language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  update app.cost_estimate_version set state='under_review'
   where wedding_id=p_wedding and id=p_estimate and state='submitted'
   returning cost_item_id into v_item;
  if v_item is null then raise exception 'estimate is not submitted' using errcode='SA022'; end if;
  insert into app.cost_decision(wedding_id,cost_item_id,estimate_version_id,decision,actor_account_id,previous_state,resulting_state)
  values(p_wedding,v_item,p_estimate,'review_started',v_actor,'submitted','under_review');
end $$;

create or replace function app.decide_cost_estimate(
  p_wedding uuid,p_estimate uuid,p_decision text,p_reason text,p_expected_state text
) returns void language plpgsql security definer set search_path=app,public as $$
declare
  v_actor uuid:=app.current_account_id(); v_item uuid; v_submitter uuid;
  v_previous app.cost_estimate_state; v_result app.cost_estimate_state;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  if p_decision not in ('approved','revision_required','rejected') then raise exception 'invalid decision'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'decision reason is required'; end if;

  select cost_item_id,submitted_by_account_id,state into v_item,v_submitter,v_previous
    from app.cost_estimate_version where wedding_id=p_wedding and id=p_estimate for update;
  if v_item is null then raise exception 'unknown estimate'; end if;
  if v_previous::text<>p_expected_state or v_previous<>'under_review' then
    raise exception 'stale estimate decision' using errcode='SA023';
  end if;
  if v_submitter=v_actor then raise exception 'submitter cannot decide their own estimate' using errcode='42501'; end if;
  v_result:=p_decision::app.cost_estimate_state;

  if v_result='approved' then
    update app.cost_estimate_version set state='superseded'
     where wedding_id=p_wedding and cost_item_id=v_item and state='approved' and id<>p_estimate;
  end if;
  update app.cost_estimate_version set state=v_result where wedding_id=p_wedding and id=p_estimate;
  update app.cost_item set lifecycle_state=case when v_result='approved' then 'approved' else 'planning' end,
    updated_at=now() where wedding_id=p_wedding and id=v_item;
  insert into app.cost_decision(
    wedding_id,cost_item_id,estimate_version_id,decision,actor_account_id,previous_state,resulting_state,reason
  ) values(p_wedding,v_item,p_estimate,p_decision,v_actor,v_previous,v_result,trim(p_reason));
end $$;

grant select on app.cost_estimate_version,app.cost_decision to authenticated,service_role;
revoke insert,update,delete on app.cost_estimate_version,app.cost_decision from public,anon,authenticated;
grant insert,update,delete on app.cost_estimate_version,app.cost_decision to service_role;

revoke execute on function app.create_cost_item(uuid,uuid,text,text,uuid,uuid,timestamptz) from public,anon;
revoke execute on function app.save_cost_estimate_draft(uuid,uuid,uuid,jsonb) from public,anon;
revoke execute on function app.submit_cost_estimate(uuid,uuid) from public,anon;
revoke execute on function app.begin_cost_review(uuid,uuid) from public,anon;
revoke execute on function app.decide_cost_estimate(uuid,uuid,text,text,text) from public,anon;
grant execute on function app.create_cost_item(uuid,uuid,text,text,uuid,uuid,timestamptz),
  app.save_cost_estimate_draft(uuid,uuid,uuid,jsonb),app.submit_cost_estimate(uuid,uuid),
  app.begin_cost_review(uuid,uuid),app.decide_cost_estimate(uuid,uuid,text,text,text)
  to authenticated,service_role;
