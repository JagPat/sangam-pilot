-- Quarantine generated Cost Control copies of retained legacy-finance rows.
begin;

alter table app.legacy_cost_control_conversion
  drop constraint if exists legacy_cost_control_conversion_outcome_check;
alter table app.legacy_cost_control_conversion
  add constraint legacy_cost_control_conversion_outcome_check
  check(outcome in ('converted','quarantined','excluded_private','excluded_cancelled'));

delete from app.cost_item
 where id in (
   select cost_item_id
     from app.legacy_cost_control_conversion
    where outcome='converted' and cost_item_id is not null
 );

-- The retired converter also left a readable centre label that revealed its provenance. Preserve any
-- manual Cost Control items: convert the centre to a neutral normal one, or merge into an existing neutral
-- centre for the wedding without deleting those manual items.
do $$
declare v_legacy record; v_neutral uuid;
begin
  for v_legacy in
    select id,wedding_id from app.cost_centre where template_key='legacy_operational'
  loop
    v_neutral:=null;
    select c.id into v_neutral
      from app.cost_centre c
     where c.wedding_id=v_legacy.wedding_id and c.id<>v_legacy.id
       and (
         c.template_key='official_costs'
         or (c.parent_id is null and c.active and lower(c.name)='official costs')
       )
     order by (c.template_key='official_costs') desc,c.id
     limit 1;

    if v_neutral is null then
      update app.cost_centre
         set template_key='official_costs',name='Official costs',updated_at=now()
       where id=v_legacy.id;
    else
      update app.cost_item
         set cost_centre_id=v_neutral,updated_at=now()
       where cost_centre_id=v_legacy.id;
      update app.cost_centre
         set parent_id=case when id=v_neutral then null else v_neutral end,
             updated_at=now()
       where parent_id=v_legacy.id;
      delete from app.cost_centre where id=v_legacy.id;
    end if;
  end loop;
end $$;

update app.legacy_cost_control_conversion
   set cost_item_id=null,
       outcome='quarantined'
 where outcome='converted';

do $$ begin
  if exists(
    select 1 from pg_policy p
    join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname='legacy_cost_control_conversion'
      and p.polname='legacy_conversion_cost_control_read'
  ) then
    drop policy legacy_conversion_cost_control_read on app.legacy_cost_control_conversion;
  end if;
end $$;
revoke all on app.legacy_cost_control_conversion from public,anon,authenticated,service_role;
grant select on app.legacy_cost_control_conversion to service_role;

create or replace function app.convert_legacy_cost_control() returns integer
language plpgsql security definer set search_path=app,pg_temp as $$
declare v_count integer:=0;
begin
  insert into app.legacy_cost_control_conversion(
    legacy_finance_cost_item_id,
    wedding_id,
    cost_item_id,
    outcome
  )
  select f.id,f.wedding_id,null,'quarantined'
    from app.finance_cost_item f
   where not exists(
     select 1
       from app.legacy_cost_control_conversion m
      where m.legacy_finance_cost_item_id=f.id
   )
  on conflict(legacy_finance_cost_item_id) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

revoke all on function app.convert_legacy_cost_control() from public,anon,authenticated,service_role;

create or replace function app.legacy_finance_inventory()
returns table(table_name text,row_count bigint)
language sql security definer set search_path=app,pg_temp as $$
  select 'finance_cost_item'::text,count(*)::bigint from app.finance_cost_item
  union all
  select 'finance_expense'::text,count(*)::bigint from app.finance_expense
  union all
  select 'finance_expense_allocation'::text,count(*)::bigint from app.finance_expense_allocation
  union all
  select 'finance_funding_signal'::text,count(*)::bigint from app.finance_funding_signal
$$;

revoke all on function app.legacy_finance_inventory() from public,anon,authenticated,service_role;
grant execute on function app.legacy_finance_inventory() to service_role;

comment on table app.finance_cost_item is
  'RETIRED: retained only for controlled data retention; every legacy mapping is quarantined and no Cost Control copy is retained.';

commit;
