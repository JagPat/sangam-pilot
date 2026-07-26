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

select 'ALL FINANCE-PRIVACY TESTS PASSED' as result;
rollback;
