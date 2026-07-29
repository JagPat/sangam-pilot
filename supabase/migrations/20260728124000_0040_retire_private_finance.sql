-- Retire the earlier family/private finance surfaces. Preserve rows for retention, but expose no client access.
-- Convert only non-private operational cost rows into submitted Cost Control estimates for fresh approval.

insert into app.account(id,email,status)
values('00000000-0000-0000-0000-000000000040','migration-cost-control@sangam.invalid','active')
on conflict(id) do nothing;

create table app.legacy_cost_control_conversion(
  legacy_finance_cost_item_id uuid primary key references app.finance_cost_item(id) on delete cascade,
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  cost_item_id uuid references app.cost_item(id) on delete set null,
  outcome text not null check(outcome in ('converted','excluded_private','excluded_cancelled')),
  converted_at timestamptz not null default now()
);
alter table app.legacy_cost_control_conversion enable row level security;
create policy legacy_conversion_cost_control_read on app.legacy_cost_control_conversion for select
  using(app.can_access_cost_control(wedding_id));

create or replace function app.convert_legacy_cost_control() returns integer
language plpgsql security definer set search_path=app,public as $$
declare r app.finance_cost_item%rowtype; v_centre uuid; v_item uuid; v_actor uuid; v_count integer:=0;
begin
  for r in select f.* from app.finance_cost_item f
    where not exists(select 1 from app.legacy_cost_control_conversion m where m.legacy_finance_cost_item_id=f.id)
    order by f.created_at,f.id
  loop
    if exists(select 1 from app.finance_expense e where e.wedding_id=r.wedding_id and e.cost_item_id=r.id) then
      insert into app.legacy_cost_control_conversion(legacy_finance_cost_item_id,wedding_id,outcome)
      values(r.id,r.wedding_id,'excluded_private');
      continue;
    end if;
    if r.payment_status='cancelled' then
      insert into app.legacy_cost_control_conversion(legacy_finance_cost_item_id,wedding_id,outcome)
      values(r.id,r.wedding_id,'excluded_cancelled');
      continue;
    end if;
    insert into app.cost_centre(wedding_id,template_key,name,sort_order)
      values(r.wedding_id,'legacy_operational','Imported official costs',900)
      on conflict(wedding_id,template_key) do update set active=true
      returning id into v_centre;
    v_actor:=coalesce(r.created_by_account_id,r.updated_by_account_id,'00000000-0000-0000-0000-000000000040'::uuid);
    insert into app.cost_item(wedding_id,cost_centre_id,engagement_id,title,description,lifecycle_state,
      decision_due_at,created_by_account_id,created_at,updated_at)
    values(r.wedding_id,v_centre,r.engagement_id,r.description,r.operational_note,'planning',r.due_date::timestamptz,
      v_actor,r.created_at,r.updated_at) returning id into v_item;
    insert into app.cost_estimate_version(wedding_id,cost_item_id,version_number,origin,subtotal,tax_rate,
      currency_code,remarks,state,created_by_account_id,submitted_by_account_id,created_at,submitted_at)
    values(r.wedding_id,v_item,1,'legacy_import',r.amount,0,r.currency_code,
      'Imported from the retired operational cost register; requires independent approval.','submitted',
      v_actor,v_actor,r.created_at,now());
    insert into app.legacy_cost_control_conversion(legacy_finance_cost_item_id,wedding_id,cost_item_id,outcome)
      values(r.id,r.wedding_id,v_item,'converted');
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

select app.convert_legacy_cost_control();

revoke all on app.finance_expense,app.finance_expense_allocation,app.finance_cost_item,app.finance_funding_signal
  from public,anon,authenticated;
revoke all on app.finance_net_position,app.finance_funding_status from public,anon,authenticated;
revoke insert,update,delete on app.legacy_cost_control_conversion from public,anon,authenticated,service_role;
grant select on app.legacy_cost_control_conversion to authenticated,service_role;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname in (
      'finance_is_group_admin_here','finance_is_viewer','finance_can_read_expense','finance_can_read_allocation',
      'finance_resolve_allocations','can_manage_finance_operations','can_read_funding_status','is_finance_admin',
      'owner_add_expense','owner_update_expense','owner_delete_expense','manager_add_cost','manager_update_cost',
      'manager_cancel_cost','finance_admin_publish_signal'
    )
  loop execute format('revoke execute on function %s from public,anon,authenticated,service_role',r.signature); end loop;
end $$;

revoke execute on function app.convert_legacy_cost_control() from public,anon,authenticated,service_role;
comment on table app.finance_expense is 'RETIRED: retained only for controlled data retention; no application access.';
comment on table app.finance_expense_allocation is 'RETIRED: retained only for controlled data retention; no application access.';
comment on table app.finance_cost_item is 'RETIRED: converted non-private rows are staged in Cost Control; no application access.';
comment on table app.finance_funding_signal is 'RETIRED: Sangam no longer records family funding status.';
