-- 19_cost_control_schema.sql — official-cost hierarchy, role separation, and same-wedding integrity.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('19000000-0000-0000-0000-000000000001','manager19@example.test'),
  ('19000000-0000-0000-0000-000000000002','approver19@example.test'),
  ('19000000-0000-0000-0000-000000000003','other19@example.test');
insert into app.account(id,auth_user_id,email) values
  ('19aa0000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','manager19@example.test'),
  ('19aa0000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000002','approver19@example.test'),
  ('19aa0000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000003','other19@example.test');
insert into app.wedding(id,title) values
  ('19000000-0000-0000-0000-000000000101','Cost wedding A'),
  ('19000000-0000-0000-0000-000000000102','Cost wedding B');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('19000000-0000-0000-0000-000000000101','19aa0000-0000-0000-0000-000000000001','active'),
  ('19000000-0000-0000-0000-000000000101','19aa0000-0000-0000-0000-000000000002','active'),
  ('19000000-0000-0000-0000-000000000102','19aa0000-0000-0000-0000-000000000003','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('19000000-0000-0000-0000-000000000101','19aa0000-0000-0000-0000-000000000001','event_manager',null),
  ('19000000-0000-0000-0000-000000000101','19aa0000-0000-0000-0000-000000000002','cost_approver',null);

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','19000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_created int; begin
  v_created:=app.initialize_cost_control('19000000-0000-0000-0000-000000000101');
  if v_created<10 then raise exception 'FAIL(template): expected standard centres, got %',v_created; end if;
  if not app.is_event_manager('19000000-0000-0000-0000-000000000101') then raise exception 'FAIL(manager role)'; end if;
  if app.is_cost_approver('19000000-0000-0000-0000-000000000101') then raise exception 'FAIL(role collapse)'; end if;
  begin
    insert into app.cost_centre(wedding_id,name) values('19000000-0000-0000-0000-000000000101','Direct write');
    raise exception 'FAIL(grant): manager directly inserted a centre';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Seed cross-wedding references as the table owner and prove composite foreign keys reject mixing.
insert into app.cost_centre(id,wedding_id,name) values
  ('19000000-0000-0000-0000-000000000201','19000000-0000-0000-0000-000000000101','A centre'),
  ('19000000-0000-0000-0000-000000000202','19000000-0000-0000-0000-000000000102','B centre');

do $$ begin
  begin
    insert into app.cost_centre(wedding_id,parent_id,name)
    values('19000000-0000-0000-0000-000000000101','19000000-0000-0000-0000-000000000202','Cross parent');
    raise exception 'FAIL(cross-centre): accepted another wedding parent';
  exception when foreign_key_violation then null; end;

  begin
    insert into app.cost_item(wedding_id,cost_centre_id,title,created_by_account_id)
    values('19000000-0000-0000-0000-000000000101','19000000-0000-0000-0000-000000000202','Cross item','19aa0000-0000-0000-0000-000000000001');
    raise exception 'FAIL(cross-item): accepted another wedding centre';
  exception when foreign_key_violation then null; end;
end $$;

do $$ declare v_forbidden int; begin
  select count(*) into v_forbidden
    from information_schema.columns
   where table_schema='app' and table_name like 'cost_%'
     and (column_name='host_group_id' or column_name ~ '(contribution|funding|balance|bank|payer_family)');
  if v_forbidden<>0 then raise exception 'FAIL(privacy-shape): found % forbidden Cost Control columns',v_forbidden; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','19000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
  if not app.is_cost_approver('19000000-0000-0000-0000-000000000101') then raise exception 'FAIL(approver role)'; end if;
  if (select count(*) from app.cost_centre where wedding_id='19000000-0000-0000-0000-000000000101')<10
    then raise exception 'FAIL(approver read): template hidden'; end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','19000000-0000-0000-0000-000000000003')::text,true);
do $$ begin
  if exists(select 1 from app.cost_centre) then raise exception 'FAIL(isolation): unrelated account read cost centres'; end if;
  begin
    perform app.initialize_cost_control('19000000-0000-0000-0000-000000000101');
    raise exception 'FAIL(authz): unrelated account initialized Cost Control';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'ALL COST-CONTROL SCHEMA TESTS PASSED' as result;
rollback;
