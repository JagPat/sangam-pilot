-- 29_cost_import_staging.sql — staged, role-separated and idempotent official-line imports.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('29000000-0000-0000-0000-000000000001','manager29@example.test'),
  ('29000000-0000-0000-0000-000000000002','approver29@example.test'),
  ('29000000-0000-0000-0000-000000000003','owner29@example.test'),
  ('29000000-0000-0000-0000-000000000004','other29@example.test');
insert into app.account(id,auth_user_id,email) values
  ('29aa0000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','manager29@example.test'),
  ('29aa0000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000002','approver29@example.test'),
  ('29aa0000-0000-0000-0000-000000000003','29000000-0000-0000-0000-000000000003','owner29@example.test'),
  ('29aa0000-0000-0000-0000-000000000004','29000000-0000-0000-0000-000000000004','other29@example.test');
insert into app.wedding(id,title) values
  ('29000000-0000-0000-0000-000000000101','Import wedding A'),
  ('29000000-0000-0000-0000-000000000102','Import wedding B');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('29000000-0000-0000-0000-000000000101','29aa0000-0000-0000-0000-000000000001','active'),
  ('29000000-0000-0000-0000-000000000101','29aa0000-0000-0000-0000-000000000002','active'),
  ('29000000-0000-0000-0000-000000000101','29aa0000-0000-0000-0000-000000000003','active'),
  ('29000000-0000-0000-0000-000000000102','29aa0000-0000-0000-0000-000000000004','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('29000000-0000-0000-0000-000000000101','29aa0000-0000-0000-0000-000000000001','event_manager',null),
  ('29000000-0000-0000-0000-000000000101','29aa0000-0000-0000-0000-000000000002','cost_approver',null),
  ('29000000-0000-0000-0000-000000000101','29aa0000-0000-0000-0000-000000000003','wedding_owner',null);
insert into app.cost_centre(id,wedding_id,name) values
  ('29000000-0000-0000-0000-000000000201','29000000-0000-0000-0000-000000000101','Entertainment'),
  ('29000000-0000-0000-0000-000000000202','29000000-0000-0000-0000-000000000101','Transport'),
  ('29000000-0000-0000-0000-000000000203','29000000-0000-0000-0000-000000000102','Other wedding');
insert into app.cost_item(id,wedding_id,cost_centre_id,title,created_by_account_id)
values('29000000-0000-0000-0000-000000000301','29000000-0000-0000-0000-000000000101',
  '29000000-0000-0000-0000-000000000201','Headline act','29aa0000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','29000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_batch uuid; begin
  v_batch:=app.stage_cost_import(
    '29000000-0000-0000-0000-000000000101','register-v1','Agreed register',
    jsonb_build_array(
      jsonb_build_object('source_line_id','line-1','title','Headline act','subtotal',3900000,'tax_rate',18,'currency_code','INR',
        'scope_included','Two-hour performance','scope_excluded','Hotel stay','resolution','matched',
        'cost_centre_id','29000000-0000-0000-0000-000000000201','matched_cost_item_id','29000000-0000-0000-0000-000000000301'),
      jsonb_build_object('source_line_id','line-2','title','Airport transfers','subtotal',1350000,'tax_rate',5,'currency_code','INR',
        'resolution','create','cost_centre_id','29000000-0000-0000-0000-000000000202'),
      jsonb_build_object('source_line_id','line-3','title','Spill-over rooms','subtotal',2500000,'tax_rate',18,'currency_code','INR',
        'resolution','unresolved')
    )
  );
  if (select count(*) from app.cost_import_line where batch_id=v_batch)<>3 then
    raise exception 'FAIL(stage): expected three staged lines';
  end if;
  if (select match_confirmed from app.cost_import_line where batch_id=v_batch and source_line_id='line-1') then
    raise exception 'FAIL(confirm): a proposed match was implicitly confirmed';
  end if;
  perform set_config('sangam.t29.batch',v_batch::text,false);

  begin
    perform app.commit_cost_import('29000000-0000-0000-0000-000000000101',v_batch);
    raise exception 'FAIL(unresolved): incomplete batch committed';
  exception when check_violation then null;
            when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  begin
    perform app.stage_cost_import(
      '29000000-0000-0000-0000-000000000101','private-v1','Private',
      jsonb_build_array(jsonb_build_object('source_line_id','private-1','title','Family contribution',
        'subtotal',1,'tax_rate',0,'currency_code','INR','resolution','create',
        'cost_centre_id','29000000-0000-0000-0000-000000000201'))
    );
    raise exception 'FAIL(privacy): private family finance entered staging';
  exception when others then
    if sqlerrm not like '%private-finance labels%' then raise; end if;
  end;

  begin
    perform app.stage_cost_import(
      '29000000-0000-0000-0000-000000000101','cross-v1','Cross wedding',
      jsonb_build_array(jsonb_build_object('source_line_id','cross-1','title','Other item',
        'subtotal',1,'tax_rate',0,'currency_code','INR','resolution','create',
        'cost_centre_id','29000000-0000-0000-0000-000000000203'))
    );
    raise exception 'FAIL(cross-wedding): accepted another wedding centre';
  exception when foreign_key_violation then null;
            when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;

-- Cost approvers can inspect staging but cannot stage, resolve, confirm or commit.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','29000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
  if (select count(*) from app.cost_import_line where wedding_id='29000000-0000-0000-0000-000000000101')<>3 then
    raise exception 'FAIL(approver read): staged lines hidden';
  end if;
  begin
    perform app.confirm_cost_import_matches('29000000-0000-0000-0000-000000000101',
      current_setting('sangam.t29.batch')::uuid,array[]::uuid[]);
    raise exception 'FAIL(approver write): approver confirmed import matches';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;

-- Wedding ownership and unrelated membership imply no Cost Control staging visibility.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','29000000-0000-0000-0000-000000000003')::text,true);
do $$ begin
  if exists(select 1 from app.cost_import_batch) then raise exception 'FAIL(owner): owner read staging by implication'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub','29000000-0000-0000-0000-000000000004')::text,true);
do $$ begin
  if exists(select 1 from app.cost_import_batch) then raise exception 'FAIL(isolation): unrelated account read staging'; end if;
end $$;
reset role;

-- Resolve and confirm, then prove an existing draft blocks the entire batch.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','29000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_batch uuid:=current_setting('sangam.t29.batch')::uuid; v_line uuid; v_draft uuid; v_result jsonb; begin
  select id into v_line from app.cost_import_line where batch_id=v_batch and source_line_id='line-3';
  perform app.resolve_cost_import_line('29000000-0000-0000-0000-000000000101',v_line,
    '29000000-0000-0000-0000-000000000202',null);
  perform app.confirm_cost_import_matches('29000000-0000-0000-0000-000000000101',v_batch,
    array[(select id from app.cost_import_line where batch_id=v_batch and source_line_id='line-1')]);

  v_draft:=app.save_cost_estimate_draft(
    '29000000-0000-0000-0000-000000000101','29000000-0000-0000-0000-000000000301',null,
    jsonb_build_object('subtotal',1,'tax_rate',0,'currency_code','INR'));
  begin
    perform app.commit_cost_import('29000000-0000-0000-0000-000000000101',v_batch);
    raise exception 'FAIL(draft collision): import overwrote or duplicated an active draft';
  exception when check_violation then null;
            when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform set_config('sangam.t29.draft',v_draft::text,false);
end $$;
reset role;

delete from app.cost_estimate_version where id=current_setting('sangam.t29.draft')::uuid;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','29000000-0000-0000-0000-000000000001')::text,true);
do $$ declare v_batch uuid:=current_setting('sangam.t29.batch')::uuid; v_result jsonb; v_matched_item_count int; begin
  v_result:=app.commit_cost_import('29000000-0000-0000-0000-000000000101',v_batch);
  if (v_result->>'written_lines')::int<>3 then raise exception 'FAIL(commit): expected three written lines, got %',v_result; end if;
  select count(*) into v_matched_item_count from app.cost_item
    where wedding_id='29000000-0000-0000-0000-000000000101' and lower(title)='headline act';
  if v_matched_item_count<>1 then raise exception 'FAIL(match): matched line duplicated its item'; end if;
  if (select count(*) from app.cost_estimate_version where id in (
    select committed_estimate_id from app.cost_import_line where batch_id=v_batch
  ) and state='draft' and origin='import')<>3 then raise exception 'FAIL(drafts): import did not create three draft estimates'; end if;
  if (select count(*) from app.cost_item where wedding_id='29000000-0000-0000-0000-000000000101'
    and title in('Airport transfers','Spill-over rooms'))<>2 then raise exception 'FAIL(create): unmatched lines were not created'; end if;

  v_result:=app.commit_cost_import('29000000-0000-0000-0000-000000000101',v_batch);
  if (v_result->>'written_lines')::int<>0 or (v_result->>'idempotent')::boolean is not true then
    raise exception 'FAIL(retry): second commit was not a no-op: %',v_result;
  end if;
end $$;
reset role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='app'
    and table_name in('cost_import_batch','cost_import_line') and grantee='authenticated'
    and privilege_type in('INSERT','UPDATE','DELETE')) then
    raise exception 'FAIL(grants): staging tables expose direct DML';
  end if;
end $$;

select 'ALL COST IMPORT STAGING TESTS PASSED' as result;
rollback;
