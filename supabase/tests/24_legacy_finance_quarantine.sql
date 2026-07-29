-- 24_legacy_finance_quarantine.sql — converted legacy finance must never remain accessible in Cost Control.
\set ON_ERROR_STOP on

-- The upgrade fixture is committed because the migration under test owns its transaction.

insert into auth.users(id,email) values ('24000000-0000-0000-0000-000000000001','manager24@example.test');
insert into app.account(id,auth_user_id,email)
values ('24aa0000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','manager24@example.test');
insert into app.wedding(id,title) values ('24000000-0000-0000-0000-000000000101','Quarantine wedding');
insert into app.wedding_membership(wedding_id,account_id,status)
values ('24000000-0000-0000-0000-000000000101','24aa0000-0000-0000-0000-000000000001','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id)
values ('24000000-0000-0000-0000-000000000101','24aa0000-0000-0000-0000-000000000001','event_manager',null);
insert into app.cost_centre(id,wedding_id,template_key,name)
values
  ('24000000-0000-0000-0000-000000000201','24000000-0000-0000-0000-000000000101','legacy_operational','Imported official costs'),
  ('24000000-0000-0000-0000-000000000202','24000000-0000-0000-0000-000000000101','official_costs','Official costs');

-- Row 301 models a pre-0044 converted mapping and its generated Cost Control copy.
-- Row 302 is intentionally unlinked: its private funding language alone must not be copied into Cost Control.
insert into app.finance_cost_item(id,wedding_id,description,operational_note,category,amount,currency_code,payment_status,created_by_account_id)
values
  ('24000000-0000-0000-0000-000000000301','24000000-0000-0000-0000-000000000101','Official catering target','Venue proposal pending','food',350000,'INR','planned','24aa0000-0000-0000-0000-000000000001'),
  ('24000000-0000-0000-0000-000000000302','24000000-0000-0000-0000-000000000101','Bride family contribution','Settled from the family private account','misc',125000,'INR','planned','24aa0000-0000-0000-0000-000000000001');
insert into app.cost_item(id,wedding_id,cost_centre_id,title,lifecycle_state,created_by_account_id)
values
  ('24000000-0000-0000-0000-000000000401','24000000-0000-0000-0000-000000000101','24000000-0000-0000-0000-000000000201','Official catering target','planning','24aa0000-0000-0000-0000-000000000001'),
  ('24000000-0000-0000-0000-000000000402','24000000-0000-0000-0000-000000000101','24000000-0000-0000-0000-000000000201','Manual floral contingency','planning','24aa0000-0000-0000-0000-000000000001');
insert into app.cost_estimate_version(id,wedding_id,cost_item_id,version_number,origin,subtotal,tax_rate,currency_code,remarks,state,created_by_account_id,submitted_by_account_id)
values ('24000000-0000-0000-0000-000000000501','24000000-0000-0000-0000-000000000101','24000000-0000-0000-0000-000000000401',1,'legacy_import',350000,0,'INR','Imported legacy fixture','submitted','24aa0000-0000-0000-0000-000000000001','24aa0000-0000-0000-0000-000000000001');
insert into app.legacy_cost_control_conversion(legacy_finance_cost_item_id,wedding_id,cost_item_id,outcome)
values ('24000000-0000-0000-0000-000000000301','24000000-0000-0000-0000-000000000101','24000000-0000-0000-0000-000000000401','converted');

-- The all-migrations runner has already replaced the old converter, so this deployed-state fixture
-- proves the equivalent pre-0044 exposure directly: both the generated copy and its import marker are readable.
set role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','24000000-0000-0000-0000-000000000001')::text,false);
do $$ begin
  if not exists(select 1 from app.cost_item where id='24000000-0000-0000-0000-000000000401') then
    raise exception 'FAIL(precondition): event manager could not read the generated legacy Cost Control copy';
  end if;
  if not exists(select 1 from app.cost_centre where id='24000000-0000-0000-0000-000000000201'
    and template_key='legacy_operational' and name='Imported official costs') then
    raise exception 'FAIL(precondition): event manager could not read the legacy conversion marker';
  end if;
end $$;
reset role;

-- Reapply the deliberately rerunnable quarantine migration to exercise the historical upgrade state.
\ir ../migrations/20260729110000_0044_legacy_finance_quarantine.sql

begin;

select app.convert_legacy_cost_control();

do $$ begin
  if (select count(*) from app.finance_cost_item where id in (
    '24000000-0000-0000-0000-000000000301',
    '24000000-0000-0000-0000-000000000302'
  )) <> 2 then
    raise exception 'FAIL(retention): quarantine deleted a legacy source row';
  end if;
  if exists(select 1 from app.cost_item where id in (
    '24000000-0000-0000-0000-000000000401'
  )) or exists(select 1 from app.cost_estimate_version where id='24000000-0000-0000-0000-000000000501') then
    raise exception 'FAIL(quarantine): generated legacy Cost Control item remains accessible';
  end if;
  if (select count(*) from app.legacy_cost_control_conversion where legacy_finance_cost_item_id in (
    '24000000-0000-0000-0000-000000000301',
    '24000000-0000-0000-0000-000000000302'
  )) <> 2 or exists(select 1 from app.legacy_cost_control_conversion where legacy_finance_cost_item_id in (
    '24000000-0000-0000-0000-000000000301',
    '24000000-0000-0000-0000-000000000302'
  ) and (outcome <> 'quarantined' or cost_item_id is not null)) then
    raise exception 'FAIL(quarantine): generated legacy mapping was not quarantined';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','24000000-0000-0000-0000-000000000001')::text,true);
do $$ begin
  begin
    perform count(*) from app.legacy_cost_control_conversion;
    raise exception 'FAIL(privacy): event manager read legacy conversion metadata';
  exception when insufficient_privilege then null; when others then raise;
  end;
  begin
    perform app.legacy_finance_inventory();
    raise exception 'FAIL(privacy): authenticated read the legacy finance inventory';
  exception when insufficient_privilege then null; when others then raise;
  end;
  if exists(select 1 from app.cost_centre where template_key ilike '%legacy%' or name ilike '%legacy%'
    or template_key ilike '%import%' or name ilike '%import%') then
    raise exception 'FAIL(privacy): event manager inferred legacy conversion from a Cost Control centre';
  end if;
  if not exists(select 1 from app.cost_item where id='24000000-0000-0000-0000-000000000402'
    and cost_centre_id='24000000-0000-0000-0000-000000000202') then
    raise exception 'FAIL(quarantine): collision handling deleted or detached a manual Cost Control item';
  end if;
end $$;
reset role;

set local role service_role;
do $$ declare v_inventory jsonb; begin
  select jsonb_object_agg(table_name,row_count) into v_inventory from app.legacy_finance_inventory();
  if v_inventory <> '{"finance_cost_item": 2, "finance_expense": 0, "finance_expense_allocation": 0, "finance_funding_signal": 0}'::jsonb then
    raise exception 'FAIL(inventory): service inventory was incomplete or exposed non-count data';
  end if;
end $$;
reset role;

do $$ begin
  if exists(
    select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='app' and p.proname='legacy_finance_inventory'
       and pg_get_function_result(p.oid) <> 'TABLE(table_name text, row_count bigint)'
  ) then
    raise exception 'FAIL(inventory): inventory return shape exposes more than table names and counts';
  end if;
  if exists(
    select 1 from pg_policy p
    join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname='legacy_cost_control_conversion'
  ) then
    raise exception 'FAIL(privacy): legacy conversion ledger retains an RLS policy';
  end if;
  if has_table_privilege('authenticated','app.legacy_cost_control_conversion','select')
    or has_table_privilege('anon','app.legacy_cost_control_conversion','select')
    or not has_table_privilege('service_role','app.legacy_cost_control_conversion','select') then
    raise exception 'FAIL(grants): legacy conversion ledger grants are not service-only';
  end if;
  if exists(
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
     where c.oid='app.legacy_cost_control_conversion'::regclass
       and a.grantee=0 and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  ) then
    raise exception 'FAIL(grants): legacy conversion ledger remains accessible to PUBLIC';
  end if;
  if not exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='legacy_finance_inventory' and p.prosecdef
  ) then
    raise exception 'FAIL(inventory): count-only inventory is not SECURITY DEFINER';
  end if;
  if has_function_privilege('anon','app.legacy_finance_inventory()','execute')
    or has_function_privilege('authenticated','app.legacy_finance_inventory()','execute')
    or not has_function_privilege('service_role','app.legacy_finance_inventory()','execute')
    or has_function_privilege('anon','app.convert_legacy_cost_control()','execute')
    or has_function_privilege('authenticated','app.convert_legacy_cost_control()','execute')
    or has_function_privilege('service_role','app.convert_legacy_cost_control()','execute') then
    raise exception 'FAIL(grants): legacy finance function grants are not fail-closed';
  end if;
  if exists(
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     where p.oid in ('app.legacy_finance_inventory()'::regprocedure,'app.convert_legacy_cost_control()'::regprocedure)
       and a.grantee=0 and a.privilege_type='EXECUTE'
  ) then
    raise exception 'FAIL(grants): legacy finance function remains executable by PUBLIC';
  end if;
end $$;

select 'ALL LEGACY FINANCE QUARANTINE TESTS PASSED' as result;
rollback;
