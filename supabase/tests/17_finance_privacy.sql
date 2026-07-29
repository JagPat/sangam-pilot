-- 17_finance_privacy.sql — event-manager operations and independent approval without family finance.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
 ('17000000-0000-0000-0000-000000000001','manager17@example.test'),
 ('17000000-0000-0000-0000-000000000002','approver17@example.test'),
 ('17000000-0000-0000-0000-000000000003','owner17@example.test');
insert into app.account(id,auth_user_id,email) values
 ('17aa0000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','manager17@example.test'),
 ('17aa0000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000002','approver17@example.test'),
 ('17aa0000-0000-0000-0000-000000000003','17000000-0000-0000-0000-000000000003','owner17@example.test');
insert into app.wedding(id,title) values('17000000-0000-0000-0000-000000000101','Privacy wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
 ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000001','active'),
 ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000002','active'),
 ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000003','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
 ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000001','event_manager',null),
 ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000002','cost_approver',null),
 ('17000000-0000-0000-0000-000000000101','17aa0000-0000-0000-0000-000000000003','wedding_owner',null);

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000001')::text,true);
do $$ begin
 if not app.is_event_manager('17000000-0000-0000-0000-000000000101') or not app.can_access_cost_control('17000000-0000-0000-0000-000000000101')
   then raise exception 'FAIL(manager): Cost Control capability missing'; end if;
 if app.is_cost_approver('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(manager): inherited approval authority'; end if;
 begin perform count(*) from app.finance_expense; raise exception 'FAIL(manager): private finance readable';
 exception when insufficient_privilege then null; when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
 if not app.is_cost_approver('17000000-0000-0000-0000-000000000101') or not app.can_access_cost_control('17000000-0000-0000-0000-000000000101')
   then raise exception 'FAIL(approver): independent approval capability missing'; end if;
 if app.is_event_manager('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(approver): inherited manager authority'; end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','17000000-0000-0000-0000-000000000003')::text,true);
do $$ begin
 if app.can_access_cost_control('17000000-0000-0000-0000-000000000101') then raise exception 'FAIL(owner): inherited Cost Control authority'; end if;
 perform app.owner_assign_wedding_role('17000000-0000-0000-0000-000000000101','new-approver@example.test','cost_approver');
 begin perform app.owner_assign_wedding_role('17000000-0000-0000-0000-000000000101','legacy@example.test','finance_admin');
   raise exception 'FAIL(assign): new legacy finance role allowed';
 exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

select 'ALL COST-CONTROL PRIVACY TESTS PASSED' as result;
rollback;
