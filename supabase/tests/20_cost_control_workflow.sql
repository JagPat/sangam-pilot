-- 20_cost_control_workflow.sql — immutable estimates, independent decisions, arithmetic, and concurrency.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('20000000-0000-0000-0000-000000000001','manager20@example.test'),
  ('20000000-0000-0000-0000-000000000002','approver20@example.test'),
  ('20000000-0000-0000-0000-000000000003','dual20@example.test');
insert into app.account(id,auth_user_id,email) values
  ('20aa0000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','manager20@example.test'),
  ('20aa0000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','approver20@example.test'),
  ('20aa0000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','dual20@example.test');
insert into app.wedding(id,title) values ('20000000-0000-0000-0000-000000000101','Workflow wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000001','active'),
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000002','active'),
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000003','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000001','event_manager',null),
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000002','cost_approver',null),
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000003','event_manager',null),
  ('20000000-0000-0000-0000-000000000101','20aa0000-0000-0000-0000-000000000003','cost_approver',null);
insert into app.cost_centre(id,wedding_id,template_key,name)
values('20000000-0000-0000-0000-000000000201','20000000-0000-0000-0000-000000000101','decor','Decor');

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','20000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_item uuid; v_est uuid; begin
  v_item:=app.create_cost_item(
    '20000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000201',
    'Sangeet stage','Official decor scope',null,null,'2026-08-01');
  v_est:=app.save_cost_estimate_draft(
    '20000000-0000-0000-0000-000000000101',v_item,null,
    jsonb_build_object('scope_included','Stage and floral','quantity',2,'unit','installation','unit_rate',50000,
      'subtotal',100000,'tax_rate',18,'currency_code','INR','remarks','First proposal'));
  perform app.save_cost_estimate_draft(
    '20000000-0000-0000-0000-000000000101',v_item,v_est,
    jsonb_build_object('scope_included','Stage and floral revised','subtotal',110000,'tax_rate',18,'currency_code','INR'));
  if (select total from app.cost_estimate_version where id=v_est)<>129800
    then raise exception 'FAIL(arithmetic): generated GST total incorrect'; end if;
  perform app.submit_cost_estimate('20000000-0000-0000-0000-000000000101',v_est);
  begin
    perform app.save_cost_estimate_draft('20000000-0000-0000-0000-000000000101',v_item,v_est,
      jsonb_build_object('subtotal',1,'tax_rate',0,'currency_code','INR'));
    raise exception 'FAIL(freeze): submitted estimate was edited';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform set_config('sangam.cost_item',v_item::text,false);
  perform set_config('sangam.estimate',v_est::text,false);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','20000000-0000-0000-0000-000000000002')::text,true);
do $$ declare v_est uuid:=current_setting('sangam.estimate')::uuid; begin
  perform app.begin_cost_review('20000000-0000-0000-0000-000000000101',v_est);
  perform app.decide_cost_estimate('20000000-0000-0000-0000-000000000101',v_est,'revision_required','Please separate flowers and staging','under_review');
  begin
    perform app.decide_cost_estimate('20000000-0000-0000-0000-000000000101',v_est,'approved','stale retry','under_review');
    raise exception 'FAIL(stale): a stale second decision succeeded';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

-- Manager starts an explicit new immutable version after revision.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','20000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_item uuid:=current_setting('sangam.cost_item')::uuid; v_est2 uuid; begin
  v_est2:=app.save_cost_estimate_draft(
    '20000000-0000-0000-0000-000000000101',v_item,null,
    jsonb_build_object('scope_included','Separated stage and floral','subtotal',105000,'tax_rate',18,'currency_code','INR'));
  if (select version_number from app.cost_estimate_version where id=v_est2)<>2
    then raise exception 'FAIL(version): revision did not create version 2'; end if;
  perform app.submit_cost_estimate('20000000-0000-0000-0000-000000000101',v_est2);
  perform set_config('sangam.estimate2',v_est2::text,false);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','20000000-0000-0000-0000-000000000002')::text,true);
do $$ declare v_est uuid:=current_setting('sangam.estimate2')::uuid; begin
  perform app.begin_cost_review('20000000-0000-0000-0000-000000000101',v_est);
  perform app.decide_cost_estimate('20000000-0000-0000-0000-000000000101',v_est,'approved','Scope and total accepted','under_review');
  if (select count(*) from app.cost_estimate_version where cost_item_id=current_setting('sangam.cost_item')::uuid and state='approved')<>1
    then raise exception 'FAIL(approved): expected one current approved version'; end if;
  if (select lifecycle_state from app.cost_item where id=current_setting('sangam.cost_item')::uuid)<>'approved'
    then raise exception 'FAIL(lifecycle): item not advanced to approved'; end if;
end $$;
reset role;

-- A dual-role submitter still cannot approve their own proposal.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','20000000-0000-0000-0000-000000000003')::text,true);
do $$ declare v_item uuid; v_est uuid; begin
  v_item:=app.create_cost_item('20000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000201','Dual role item',null,null,null,null);
  v_est:=app.save_cost_estimate_draft('20000000-0000-0000-0000-000000000101',v_item,null,
    jsonb_build_object('subtotal',1000,'tax_rate',0,'currency_code','INR'));
  perform app.submit_cost_estimate('20000000-0000-0000-0000-000000000101',v_est);
  perform app.begin_cost_review('20000000-0000-0000-0000-000000000101',v_est);
  begin
    perform app.decide_cost_estimate('20000000-0000-0000-0000-000000000101',v_est,'approved','self approval','under_review');
    raise exception 'FAIL(self-approval): submitter approved own estimate';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='app'
    and table_name in('cost_estimate_version','cost_decision') and grantee='authenticated'
    and privilege_type in('INSERT','UPDATE','DELETE')) then
    raise exception 'FAIL(grants): workflow tables expose direct DML';
  end if;
end $$;

select 'ALL COST-CONTROL WORKFLOW TESTS PASSED' as result;
rollback;
