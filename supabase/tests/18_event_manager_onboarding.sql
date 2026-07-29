-- 18_event_manager_onboarding.sql — creator entitlement is platform-controlled and wedding creation
-- atomically grants the approved planner both wedding_owner and event_manager.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('18000000-0000-0000-0000-000000000001','platform@example.test'),
  ('18000000-0000-0000-0000-000000000002','planner@example.test'),
  ('18000000-0000-0000-0000-000000000003','manager@example.test'),
  ('18000000-0000-0000-0000-000000000004','ordinary@example.test');

insert into app.account(id,auth_user_id,email) values
  ('18aa0000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','platform@example.test'),
  ('18aa0000-0000-0000-0000-000000000002','18000000-0000-0000-0000-000000000002','planner@example.test'),
  ('18aa0000-0000-0000-0000-000000000003','18000000-0000-0000-0000-000000000003','manager@example.test'),
  ('18aa0000-0000-0000-0000-000000000004','18000000-0000-0000-0000-000000000004','ordinary@example.test');

insert into app.platform_role(account_id,role)
values ('18aa0000-0000-0000-0000-000000000001','platform_super_admin');

-- A wedding-scoped manager role alone must not grant account-level creator access.
insert into app.wedding(id,title) values ('18000000-0000-0000-0000-000000000100','Existing wedding');
insert into app.wedding_membership(wedding_id,account_id,status)
values ('18000000-0000-0000-0000-000000000100','18aa0000-0000-0000-0000-000000000003','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id)
values ('18000000-0000-0000-0000-000000000100','18aa0000-0000-0000-0000-000000000003','event_manager',null);

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','18000000-0000-0000-0000-000000000001')::text,true);
select app.super_admin_set_wedding_creator('planner@example.test',true);

select set_config('request.jwt.claims',json_build_object('sub','18000000-0000-0000-0000-000000000002')::text,true);
do $$ declare v_wedding uuid; begin
  if not app.current_account_can_create_wedding() then
    raise exception 'FAIL(capability): provisioned planner is not creator-enabled';
  end if;
  v_wedding:=app.create_wedding('Planner-created wedding',null,'Asia/Kolkata',null,null);
  if (select count(*) from app.operator_role
       where wedding_id=v_wedding and account_id='18aa0000-0000-0000-0000-000000000002'
         and role::text in ('wedding_owner','event_manager') and host_group_id is null)<>2 then
    raise exception 'FAIL(roles): creation did not atomically grant owner and manager';
  end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','18000000-0000-0000-0000-000000000003')::text,true);
do $$ begin
  if app.current_account_can_create_wedding() then
    raise exception 'FAIL(scope): wedding manager role implied creator entitlement';
  end if;
  begin
    perform app.create_wedding('Unauthorized wedding',null,'Asia/Kolkata',null,null);
    raise exception 'FAIL(scope): unprovisioned manager created another wedding';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','18000000-0000-0000-0000-000000000004')::text,true);
do $$ begin
  begin
    perform app.super_admin_set_wedding_creator('ordinary@example.test',true);
    raise exception 'FAIL(admin): ordinary user provisioned a wedding creator';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$ begin
  begin
    perform app.super_admin_set_wedding_creator('anon@example.test',true);
    raise exception 'FAIL(anon): anonymous caller reached creator provisioning';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','18000000-0000-0000-0000-000000000001')::text,true);
select app.super_admin_set_wedding_creator('planner@example.test',false);
select set_config('request.jwt.claims',json_build_object('sub','18000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
  if app.current_account_can_create_wedding() then
    raise exception 'FAIL(revoke): disabled creator entitlement remained active';
  end if;
  begin
    perform app.create_wedding('Second wedding',null,'Asia/Kolkata',null,null);
    raise exception 'FAIL(revoke): disabled planner created another wedding';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL EVENT-MANAGER ONBOARDING TESTS PASSED' as result;
rollback;
