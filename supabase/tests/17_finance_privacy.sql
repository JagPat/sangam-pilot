-- 17_finance_privacy.sql — role separation, manager-safe operational finance, and private-ledger denial.
-- Every assertion runs against real PostgreSQL roles; production changes that collapse event_manager,
-- finance_admin, wedding_owner, or platform_super_admin authority must fail this suite.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('17000000-0000-0000-0000-000000000001','jagrutpatel@gmail.com'),
  ('17000000-0000-0000-0000-000000000002','finance@example.test'),
  ('17000000-0000-0000-0000-000000000003','owner@example.test'),
  ('17000000-0000-0000-0000-000000000004','other@example.test');
insert into app.account(id,auth_user_id,email) values
  ('17aa0000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','jagrutpatel@gmail.com'),
  ('17aa0000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000002','finance@example.test'),
  ('17aa0000-0000-0000-0000-000000000003','17000000-0000-0000-0000-000000000003','owner@example.test'),
  ('17aa0000-0000-0000-0000-000000000004','17000000-0000-0000-0000-000000000004','other@example.test');
-- Migrations run before suite fixtures. Mirror the service-controlled production provisioning step.
insert into app.platform_role(account_id,role)
values ('17aa0000-0000-0000-0000-000000000001','platform_super_admin');
insert into app.wedding(id,title) values
  ('17000000-0000-0000-0000-000000000101','Privacy wedding'),
  ('17000000-0000-0000-0000-000000000102','Other wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000001','active'),
  ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000002','active'),
  ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000003','active'),
  ('17000000-0000-0000-0000-000000000102','17aa0000-0000-0000-0000-000000000004','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000001','event_manager',null),
  ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000002','finance_admin',null),
  ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000003','wedding_owner',null),
  ('17000000-0000-0000-0000-000000000102','17aa0000-0000-0000-0000-000000000004','event_manager',null);

insert into app.host_group(id,wedding_id,kind,name) values
  ('17000000-0000-0000-0000-000000000201','17000000-0000-0000-0000-000000000101','bride_family','Bride family'),
  ('17000000-0000-0000-0000-000000000202','17000000-0000-0000-0000-000000000101','groom_family','Groom family');
insert into app.finance_cost_item(id,wedding_id,description,category,amount,currency_code,due_date,payment_status,paid_at)
values ('17000000-0000-0000-0000-000000000302','17000000-0000-0000-0000-000000000101','Private family contribution','family',100000,'INR','2026-07-01','paid','2026-07-01');
insert into app.finance_expense(id,wedding_id,cost_item_id,description,category,amount,currency_code,paid_at,paid_by_host_group_id,created_by_account_id)
values ('17000000-0000-0000-0000-000000000301','17000000-0000-0000-0000-000000000101','17000000-0000-0000-0000-000000000302','Private family contribution','family',100000,'INR','2026-07-01','17000000-0000-0000-0000-000000000201','17aa0000-0000-0000-0000-000000000002');
insert into app.finance_expense_allocation(wedding_id,expense_id,responsible_host_group_id,allocation_amount) values
  ('17000000-0000-0000-0000-000000000101','17000000-0000-0000-0000-000000000301','17000000-0000-0000-0000-000000000201',50000),
  ('17000000-0000-0000-0000-000000000101','17000000-0000-0000-0000-000000000301','17000000-0000-0000-0000-000000000202',50000);

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000001')::text,true);
do $$ begin
  if not app.is_platform_super_admin() then raise exception 'FAIL(role): configured account is not platform super-admin'; end if;
  if not app.is_event_manager('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(role): event-manager capability missing'; end if;
  if app.is_finance_admin('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(role): event manager became finance admin'; end if;
  if app.is_event_manager('17000000-0000-0000-0000-000000000102') then raise exception 'FAIL(role): event manager crossed weddings'; end if;
  begin perform count(*) from app.platform_role; raise exception 'FAIL(role): authenticated read platform roles directly';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
  if not app.is_finance_admin('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(role): finance-admin capability missing'; end if;
  if app.is_event_manager('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(role): finance admin implicitly became manager'; end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000003')::text,true);
do $$ begin
  if app.is_finance_admin('17000000-0000-0000-0000-000000000101') or app.is_event_manager('17000000-0000-0000-0000-000000000101')
    then raise exception 'FAIL(role): wedding owner inherited finance/manager authority'; end if;
  perform app.owner_assign_wedding_role('17000000-0000-0000-0000-000000000101','appointed@example.test','finance_admin');
  if not exists(select 1 from app.owner_list_operators('17000000-0000-0000-0000-000000000101')
    where email='appointed@example.test' and role='finance_admin' and host_group_id is null)
    then raise exception 'FAIL(assign): wedding administrator could not appoint finance administrator'; end if;
end $$;
reset role;

-- The status surface must be structurally incapable of returning a balance or family attribution.
do $$ declare v_bad int; begin
  select count(*) into v_bad from information_schema.columns
   where table_schema='app' and table_name='finance_funding_status'
     and column_name not in ('wedding_id','currency_code','status','updated_at');
  if v_bad <> 0 then raise exception 'FAIL(signal-shape): manager status view exposes % extra columns',v_bad; end if;
end $$;

-- Finance admin publishes two independent manual signals.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000002')::text,true);
select app.finance_admin_publish_signal('17000000-0000-0000-0000-000000000101','INR','funded');
select app.finance_admin_publish_signal('17000000-0000-0000-0000-000000000101','USD','funds_needed');
reset role;

-- Event manager manages operational costs but cannot publish or inspect the private signal row.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_cost uuid; v_private_cost uuid; v_status app.funding_status; v_count int; begin
  v_cost:=app.manager_add_cost('17000000-0000-0000-0000-000000000101','Catering deposit','catering',250000,'INR','2026-08-01','due',null,'Vendor invoice 17');
  select count(*) into v_count from app.finance_cost_item where id=v_cost and amount=250000 and currency_code='INR';
  if v_count<>1 then raise exception 'FAIL(manager-cost): manager could not create/read operational cost'; end if;
  select status into v_status from app.finance_funding_status
   where wedding_id='17000000-0000-0000-0000-000000000101' and currency_code='INR';
  if v_status<>'funded' then raise exception 'FAIL(signal): manager did not see INR funded'; end if;
  if (select count(*) from app.finance_funding_status where wedding_id='17000000-0000-0000-0000-000000000101')<>2
    then raise exception 'FAIL(signal): manager did not see separate INR/USD signals'; end if;
  begin
    perform app.finance_admin_publish_signal('17000000-0000-0000-0000-000000000101','INR','funds_needed');
    raise exception 'FAIL(signal-authz): manager published funding status';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform count(*) from app.finance_funding_signal;
    raise exception 'FAIL(signal-private): manager read private signal table';
  exception when insufficient_privilege then null; end;
  begin perform app.owner_assign_wedding_role('17000000-0000-0000-0000-000000000101','intruder@example.test','finance_admin');
    raise exception 'FAIL(assign-authz): event manager appointed a finance administrator';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform app.manager_update_cost('17000000-0000-0000-0000-000000000101',v_cost,'Catering deposit','catering',275000,'INR','2026-08-02','part_paid',null,'Vendor invoice 17');
  select status into v_status from app.finance_funding_status where wedding_id='17000000-0000-0000-0000-000000000101' and currency_code='INR';
  if v_status<>'funded' then raise exception 'FAIL(side-channel): cost update changed manual funding signal'; end if;
  perform app.manager_cancel_cost('17000000-0000-0000-0000-000000000101',v_cost);
  if (select payment_status from app.finance_cost_item where id=v_cost)<>'cancelled' then raise exception 'FAIL(cancel): cost not cancelled'; end if;
  if exists(select 1 from app.finance_expense where wedding_id='17000000-0000-0000-0000-000000000101')
    then raise exception 'FAIL(private-ledger): event manager read family contribution details'; end if;
  if exists(select 1 from app.finance_net_position where wedding_id='17000000-0000-0000-0000-000000000101')
    then raise exception 'FAIL(private-net): event manager read family balances'; end if;
  select id into v_private_cost from app.finance_cost_item where description='Private family contribution';
  if v_private_cost is null then raise exception 'FAIL(operations): manager cannot see settlement operational twin'; end if;
  begin perform app.manager_update_cost('17000000-0000-0000-0000-000000000101',v_private_cost,
    'Private family contribution','family',90000,'INR','2026-07-01','paid','2026-07-01',null);
    raise exception 'FAIL(private-integrity): manager changed a settled amount';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform app.manager_cancel_cost('17000000-0000-0000-0000-000000000101',v_private_cost);
    raise exception 'FAIL(private-integrity): manager cancelled a settled cost';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

-- Owner-only and other-wedding actors get no operational access by implication.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000003')::text,true);
do $$ begin
  if exists(select 1 from app.finance_cost_item where wedding_id='17000000-0000-0000-0000-000000000101')
    then raise exception 'FAIL(owner-cost): wedding owner inherited manager cost access'; end if;
  begin perform app.manager_add_cost('17000000-0000-0000-0000-000000000101','Sneaky','misc',1,'INR',null,'planned',null,null);
    raise exception 'FAIL(owner-cost): owner used manager RPC';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if exists(select 1 from app.finance_expense where wedding_id='17000000-0000-0000-0000-000000000101')
    then raise exception 'FAIL(owner-private): wedding owner inherited family-finance access'; end if;
end $$;
reset role;

-- Finance admin retains full private-ledger access and every migrated private row has an operational twin.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
  if (select count(*) from app.finance_expense where wedding_id='17000000-0000-0000-0000-000000000101')<>1
    then raise exception 'FAIL(finance-admin): private expense not visible'; end if;
  if exists(select 1 from app.finance_cost_item where wedding_id='17000000-0000-0000-0000-000000000101')
    then raise exception 'FAIL(finance-admin): private authority implied operational cost access'; end if;
  perform app.owner_update_expense('17000000-0000-0000-0000-000000000101','17000000-0000-0000-0000-000000000301',
    'Private family contribution revised','family',120000,'INR','2026-07-02','17000000-0000-0000-0000-000000000201',null,
    '[{"group":"17000000-0000-0000-0000-000000000201","percent":50},{"group":"17000000-0000-0000-0000-000000000202","percent":50}]'::jsonb);
end $$;
reset role;

do $$ begin
  if not exists(select 1 from app.finance_expense e join app.finance_cost_item c
      on c.wedding_id=e.wedding_id and c.id=e.cost_item_id
      where e.id='17000000-0000-0000-0000-000000000301' and e.amount=120000 and c.amount=120000 and c.description=e.description)
    then raise exception 'FAIL(sync): finance-admin update did not synchronize operational cost'; end if;
end $$;

set local role anon;
do $$ begin
  begin perform app.manager_add_cost('17000000-0000-0000-0000-000000000101','Anon','misc',1,'INR',null,'planned',null,null);
    raise exception 'FAIL(anon): anon executed manager RPC';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; else raise exception 'FAIL(anon): wrong denial: %',sqlerrm; end if; end;
end $$;
reset role;

select 'ALL FINANCE-PRIVACY TESTS PASSED' as result;
rollback;
