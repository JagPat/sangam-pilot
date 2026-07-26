-- Separate private family settlement data from wedding administration and operational cost work.
-- Existing private expenses are preserved and receive an operational cost twin.

alter table app.finance_expense add column cost_item_id uuid default gen_random_uuid();

insert into app.finance_cost_item(
  id,wedding_id,description,category,amount,currency_code,due_date,payment_status,paid_at,
  operational_note,created_by_account_id,updated_by_account_id,created_at,updated_at
)
select cost_item_id,wedding_id,description,category,amount,currency_code,paid_at,'paid',paid_at,
       null,created_by_account_id,created_by_account_id,created_at,created_at
  from app.finance_expense;

alter table app.finance_expense alter column cost_item_id drop default;
alter table app.finance_expense alter column cost_item_id set not null;
alter table app.finance_expense add constraint finance_expense_cost_unique unique(wedding_id,cost_item_id);
alter table app.finance_expense add constraint finance_expense_cost_fk
  foreign key(wedding_id,cost_item_id) references app.finance_cost_item(wedding_id,id);

create or replace function app.finance_can_read_expense(p_wedding uuid,p_expense uuid) returns boolean
language plpgsql stable security definer set search_path=app,public as $$
declare v_payer uuid;
begin
  if app.is_finance_admin(p_wedding) then return true; end if;
  select paid_by_host_group_id into v_payer from app.finance_expense where wedding_id=p_wedding and id=p_expense;
  if v_payer is null then return false; end if;
  if app.finance_is_group_admin_here(p_wedding,v_payer) then return true; end if;
  return exists(
    select 1 from app.finance_expense_allocation a
     where a.wedding_id=p_wedding and a.expense_id=p_expense
       and app.finance_is_group_admin_here(p_wedding,a.responsible_host_group_id)
  );
end $$;

create or replace function app.finance_can_read_allocation(p_wedding uuid,p_allocation uuid) returns boolean
language plpgsql stable security definer set search_path=app,public as $$
declare v_exp uuid; v_resp uuid; v_payer uuid;
begin
  if app.is_finance_admin(p_wedding) then return true; end if;
  select expense_id,responsible_host_group_id into v_exp,v_resp
    from app.finance_expense_allocation where wedding_id=p_wedding and id=p_allocation;
  if v_exp is null then return false; end if;
  if app.finance_is_group_admin_here(p_wedding,v_resp) then return true; end if;
  select paid_by_host_group_id into v_payer from app.finance_expense where wedding_id=p_wedding and id=v_exp;
  return v_payer is not null and app.finance_is_group_admin_here(p_wedding,v_payer);
end $$;

create or replace function app.finance_is_viewer(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_member(p_wedding) and (
    app.is_finance_admin(p_wedding) or exists(
      select 1 from app.operator_role r
       where r.wedding_id=p_wedding and r.account_id=app.current_account_id()
         and r.role::text='host_group_admin'
    )
  );
$$;

create or replace function app.owner_add_expense(
  p_wedding uuid,p_description text,p_category text,p_amount numeric,p_currency text,
  p_paid_at date,p_paid_by_host_group uuid,p_note text,p_allocations jsonb
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_exp uuid; v_cost uuid; v_amt numeric(14,2); r record;
begin
  if not app.is_finance_admin(p_wedding) then raise exception 'not authorized to manage private finance' using errcode='42501'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive'; end if;
  if p_paid_by_host_group is null then raise exception 'a paying host group is required'; end if;
  v_amt:=round(p_amount,2);
  insert into app.finance_cost_item(wedding_id,description,category,amount,currency_code,due_date,payment_status,paid_at,
    operational_note,created_by_account_id,updated_by_account_id)
  values(p_wedding,trim(p_description),coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),v_amt,upper(trim(p_currency)),
    p_paid_at,'paid',p_paid_at,null,app.current_account_id(),app.current_account_id()) returning id into v_cost;
  insert into app.finance_expense(wedding_id,cost_item_id,description,category,amount,currency_code,paid_at,
    paid_by_host_group_id,created_by_account_id,note)
  values(p_wedding,v_cost,trim(p_description),coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),v_amt,
    upper(trim(p_currency)),p_paid_at,p_paid_by_host_group,app.current_account_id(),nullif(trim(coalesce(p_note,'')),''))
  returning id into v_exp;
  for r in select * from app.finance_resolve_allocations(v_amt,p_allocations) loop
    insert into app.finance_expense_allocation(wedding_id,expense_id,responsible_host_group_id,allocation_amount)
    values(p_wedding,v_exp,r.host_group_id,r.amount);
  end loop;
  return v_exp;
end $$;

create or replace function app.owner_update_expense(
  p_wedding uuid,p_expense uuid,p_description text,p_category text,p_amount numeric,p_currency text,
  p_paid_at date,p_paid_by_host_group uuid,p_note text,p_allocations jsonb
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_amt numeric(14,2); v_cost uuid; r record;
begin
  if not app.is_finance_admin(p_wedding) then raise exception 'not authorized to manage private finance' using errcode='42501'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive'; end if;
  v_amt:=round(p_amount,2);
  select cost_item_id into v_cost from app.finance_expense where wedding_id=p_wedding and id=p_expense for update;
  if v_cost is null then raise exception 'unknown expense'; end if;
  update app.finance_expense set description=trim(p_description),category=coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),
    amount=v_amt,currency_code=upper(trim(p_currency)),paid_at=p_paid_at,paid_by_host_group_id=p_paid_by_host_group,
    note=nullif(trim(coalesce(p_note,'')),'') where wedding_id=p_wedding and id=p_expense;
  delete from app.finance_expense_allocation where wedding_id=p_wedding and expense_id=p_expense;
  for r in select * from app.finance_resolve_allocations(v_amt,p_allocations) loop
    insert into app.finance_expense_allocation(wedding_id,expense_id,responsible_host_group_id,allocation_amount)
    values(p_wedding,p_expense,r.host_group_id,r.amount);
  end loop;
  update app.finance_cost_item set description=trim(p_description),category=coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),
    amount=v_amt,currency_code=upper(trim(p_currency)),due_date=p_paid_at,payment_status='paid',paid_at=p_paid_at,
    updated_by_account_id=app.current_account_id(),updated_at=now() where wedding_id=p_wedding and id=v_cost;
end $$;

create or replace function app.owner_delete_expense(p_wedding uuid,p_expense uuid) returns void
language plpgsql security definer set search_path=app,public as $$
begin
  if not app.is_finance_admin(p_wedding) then raise exception 'not authorized to manage private finance' using errcode='42501'; end if;
  delete from app.finance_expense where wedding_id=p_wedding and id=p_expense;
  if not found then raise exception 'unknown expense'; end if;
end $$;

-- A manager may edit operational metadata on a settled item, but cannot rewrite private financial truth.
create or replace function app.manager_update_cost(
  p_wedding uuid,p_cost uuid,p_description text,p_category text,p_amount numeric,p_currency text,
  p_due_date date,p_payment_status text,p_paid_at date,p_note text
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_state app.cost_payment_status; v_current app.finance_cost_item%rowtype; v_private boolean;
begin
  if not app.can_manage_finance_operations(p_wedding) then raise exception 'not authorized to manage wedding costs' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'description is required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive'; end if;
  select * into v_current from app.finance_cost_item where wedding_id=p_wedding and id=p_cost for update;
  if not found then raise exception 'unknown cost item'; end if;
  select exists(select 1 from app.finance_expense where wedding_id=p_wedding and cost_item_id=p_cost) into v_private;
  v_state:=coalesce(nullif(trim(coalesce(p_payment_status,'')),''),'planned')::app.cost_payment_status;
  if v_private and not app.is_finance_admin(p_wedding) and
     (round(p_amount,2)<>v_current.amount or upper(trim(p_currency))<>v_current.currency_code or
      v_state<>v_current.payment_status or p_paid_at is distinct from v_current.paid_at) then
    raise exception 'finance admin must change settled amount, currency, or payment state' using errcode='42501';
  end if;
  update app.finance_cost_item set description=trim(p_description),category=coalesce(nullif(trim(coalesce(p_category,'')),''),'misc'),
    amount=round(p_amount,2),currency_code=upper(trim(p_currency)),due_date=p_due_date,payment_status=v_state,paid_at=p_paid_at,
    operational_note=nullif(trim(coalesce(p_note,'')),''),updated_by_account_id=app.current_account_id(),updated_at=now()
   where wedding_id=p_wedding and id=p_cost;
end $$;

create or replace function app.manager_cancel_cost(p_wedding uuid,p_cost uuid) returns void
language plpgsql security definer set search_path=app,public as $$
begin
  if not app.can_manage_finance_operations(p_wedding) then raise exception 'not authorized to manage wedding costs' using errcode='42501'; end if;
  if not app.is_finance_admin(p_wedding) and exists(
    select 1 from app.finance_expense where wedding_id=p_wedding and cost_item_id=p_cost
  ) then raise exception 'finance admin must cancel a settled cost' using errcode='42501'; end if;
  update app.finance_cost_item set payment_status='cancelled',paid_at=null,updated_by_account_id=app.current_account_id(),updated_at=now()
   where wedding_id=p_wedding and id=p_cost;
  if not found then raise exception 'unknown cost item'; end if;
end $$;
