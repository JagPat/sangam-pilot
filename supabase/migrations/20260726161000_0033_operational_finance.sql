-- Manager-safe operational costs and a manually published, amount-free funding signal.
create type app.cost_payment_status as enum ('planned','due','part_paid','paid','cancelled');
create type app.funding_status as enum ('not_assessed','funded','funds_needed');

create table app.finance_cost_item (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  engagement_id uuid,
  description text not null check (length(trim(description))>0),
  category text not null default 'misc',
  amount numeric(14,2) not null check (amount>0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  due_date date,
  payment_status app.cost_payment_status not null default 'planned',
  paid_at date,
  operational_note text,
  created_by_account_id uuid references app.account(id) on delete set null,
  updated_by_account_id uuid references app.account(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(wedding_id,id),
  foreign key(wedding_id,engagement_id) references app.engagement(wedding_id,id),
  constraint cost_paid_date_shape check (
    (payment_status='paid' and paid_at is not null)
    or (payment_status<>'paid' and paid_at is null)
  )
);
create index finance_cost_item_wedding_idx on app.finance_cost_item(wedding_id,currency_code);

create table app.finance_funding_signal (
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  status app.funding_status not null default 'not_assessed',
  updated_by_account_id uuid not null references app.account(id),
  updated_at timestamptz not null default now(),
  primary key(wedding_id,currency_code)
);

create or replace function app.can_manage_finance_operations(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_event_manager(p_wedding) or app.is_finance_admin(p_wedding);
$$;

create or replace function app.can_read_funding_status(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_wedding_owner(p_wedding) or app.is_event_manager(p_wedding)
      or app.is_finance_admin(p_wedding)
      or exists (
        select 1 from app.operator_role r
         where r.wedding_id=p_wedding and r.account_id=app.current_account_id()
           and r.role::text='host_group_admin' and app.is_member(p_wedding)
      );
$$;

alter table app.finance_cost_item enable row level security;
alter table app.finance_funding_signal enable row level security;
create policy finance_cost_read on app.finance_cost_item for select
  using(app.can_manage_finance_operations(wedding_id));

-- Definer view reads the private row but publishes only the four safe columns.
create view app.finance_funding_status with (security_barrier=true) as
select wedding_id,currency_code,status,updated_at
  from app.finance_funding_signal
 where app.can_read_funding_status(wedding_id);

create or replace function app.manager_add_cost(
  p_wedding uuid,p_description text,p_category text,p_amount numeric,p_currency text,
  p_due_date date,p_payment_status text,p_paid_at date,p_note text
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_id uuid; v_state app.cost_payment_status;
begin
  if not app.can_manage_finance_operations(p_wedding) then raise exception 'not authorized to manage wedding costs' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'description is required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive'; end if;
  v_state:=coalesce(nullif(trim(coalesce(p_payment_status,'')),''),'planned')::app.cost_payment_status;
  insert into app.finance_cost_item(wedding_id,description,category,amount,currency_code,due_date,payment_status,paid_at,operational_note,created_by_account_id,updated_by_account_id)
  values(p_wedding,trim(p_description),coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),round(p_amount,2),upper(trim(p_currency)),p_due_date,v_state,p_paid_at,nullif(trim(coalesce(p_note,'')),''),app.current_account_id(),app.current_account_id())
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.manager_update_cost(
  p_wedding uuid,p_cost uuid,p_description text,p_category text,p_amount numeric,p_currency text,
  p_due_date date,p_payment_status text,p_paid_at date,p_note text
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_state app.cost_payment_status;
begin
  if not app.can_manage_finance_operations(p_wedding) then raise exception 'not authorized to manage wedding costs' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'description is required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive'; end if;
  v_state:=coalesce(nullif(trim(coalesce(p_payment_status,'')),''),'planned')::app.cost_payment_status;
  update app.finance_cost_item set description=trim(p_description),category=coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),
    amount=round(p_amount,2),currency_code=upper(trim(p_currency)),due_date=p_due_date,payment_status=v_state,
    paid_at=p_paid_at,operational_note=nullif(trim(coalesce(p_note,'')),''),updated_by_account_id=app.current_account_id(),updated_at=now()
   where wedding_id=p_wedding and id=p_cost;
  if not found then raise exception 'unknown cost item'; end if;
end $$;

create or replace function app.manager_cancel_cost(p_wedding uuid,p_cost uuid) returns void
language plpgsql security definer set search_path=app,public as $$
begin
  if not app.can_manage_finance_operations(p_wedding) then raise exception 'not authorized to manage wedding costs' using errcode='42501'; end if;
  update app.finance_cost_item set payment_status='cancelled',paid_at=null,updated_by_account_id=app.current_account_id(),updated_at=now()
   where wedding_id=p_wedding and id=p_cost;
  if not found then raise exception 'unknown cost item'; end if;
end $$;

create or replace function app.finance_admin_publish_signal(p_wedding uuid,p_currency text,p_status app.funding_status) returns void
language plpgsql security definer set search_path=app,public as $$
begin
  if not app.is_finance_admin(p_wedding) then raise exception 'not authorized to publish funding status' using errcode='42501'; end if;
  insert into app.finance_funding_signal(wedding_id,currency_code,status,updated_by_account_id,updated_at)
  values(p_wedding,upper(trim(p_currency)),p_status,app.current_account_id(),now())
  on conflict(wedding_id,currency_code) do update set status=excluded.status,updated_by_account_id=excluded.updated_by_account_id,updated_at=now();
end $$;

grant select on app.finance_cost_item,app.finance_funding_status to authenticated;
revoke all on app.finance_funding_signal from public,anon,authenticated;
revoke execute on function app.can_manage_finance_operations(uuid) from public,anon;
revoke execute on function app.can_read_funding_status(uuid) from public,anon;
grant execute on function app.can_manage_finance_operations(uuid),app.can_read_funding_status(uuid) to authenticated;

revoke execute on function app.manager_add_cost(uuid,text,text,numeric,text,date,text,date,text) from public,anon;
revoke execute on function app.manager_update_cost(uuid,uuid,text,text,numeric,text,date,text,date,text) from public,anon;
revoke execute on function app.manager_cancel_cost(uuid,uuid) from public,anon;
revoke execute on function app.finance_admin_publish_signal(uuid,text,app.funding_status) from public,anon;
grant execute on function app.manager_add_cost(uuid,text,text,numeric,text,date,text,date,text) to authenticated;
grant execute on function app.manager_update_cost(uuid,uuid,text,text,numeric,text,date,text,date,text) to authenticated;
grant execute on function app.manager_cancel_cost(uuid,uuid) to authenticated;
grant execute on function app.finance_admin_publish_signal(uuid,text,app.funding_status) to authenticated;
