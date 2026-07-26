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
do $$ declare v_cost uuid; v_status app.funding_status; v_count int; begin
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
  perform app.manager_update_cost('17000000-0000-0000-0000-000000000101',v_cost,'Catering deposit','catering',275000,'INR','2026-08-02','part_paid',null,'Vendor invoice 17');
  select status into v_status from app.finance_funding_status where wedding_id='17000000-0000-0000-0000-000000000101' and currency_code='INR';
  if v_status<>'funded' then raise exception 'FAIL(side-channel): cost update changed manual funding signal'; end if;
  perform app.manager_cancel_cost('17000000-0000-0000-0000-000000000101',v_cost);
  if (select payment_status from app.finance_cost_item where id=v_cost)<>'cancelled' then raise exception 'FAIL(cancel): cost not cancelled'; end if;
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
end $$;
reset role;

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
