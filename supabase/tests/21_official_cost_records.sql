-- 21_official_cost_records.sql — approved commitments, verified invoices and bounded official payments.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('21000000-0000-0000-0000-000000000001','manager21@example.test'),
  ('21000000-0000-0000-0000-000000000002','approver21@example.test');
insert into app.account(id,auth_user_id,email) values
  ('21aa0000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','manager21@example.test'),
  ('21aa0000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000002','approver21@example.test');
insert into app.wedding(id,title) values ('21000000-0000-0000-0000-000000000101','Official cost wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('21000000-0000-0000-0000-000000000101','21aa0000-0000-0000-0000-000000000001','active'),
  ('21000000-0000-0000-0000-000000000101','21aa0000-0000-0000-0000-000000000002','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('21000000-0000-0000-0000-000000000101','21aa0000-0000-0000-0000-000000000001','event_manager',null),
  ('21000000-0000-0000-0000-000000000101','21aa0000-0000-0000-0000-000000000002','cost_approver',null);
insert into app.cost_centre(id,wedding_id,template_key,name)
values('21000000-0000-0000-0000-000000000201','21000000-0000-0000-0000-000000000101','venue','Venue');

-- Build one independently approved estimate using the public workflow.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000001')::text,true);
do $$ declare i uuid; e uuid; begin
  i:=app.create_cost_item('21000000-0000-0000-0000-000000000101','21000000-0000-0000-0000-000000000201','Ballroom hire',null,null,null,null);
  e:=app.save_cost_estimate_draft('21000000-0000-0000-0000-000000000101',i,null,
    jsonb_build_object('subtotal',100000,'tax_rate',18,'currency_code','INR'));
  perform app.submit_cost_estimate('21000000-0000-0000-0000-000000000101',e);
  perform set_config('sangam.t21.item',i::text,false); perform set_config('sangam.t21.estimate',e::text,false);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000002')::text,true);
select app.begin_cost_review('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.estimate')::uuid);
select app.decide_cost_estimate('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.estimate')::uuid,'approved','Official estimate accepted','under_review');
reset role;

-- Manager may propose an official commitment but cannot approve it.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000001')::text,true);
do $$ declare c uuid; begin
  c:=app.propose_cost_commitment('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.item')::uuid,
    current_setting('sangam.t21.estimate')::uuid,null,'VENUE-QUOTE-7','2026-09-01');
  perform set_config('sangam.t21.commitment',c::text,false);
  begin
    perform app.decide_cost_commitment('21000000-0000-0000-0000-000000000101',c,'approved','manager self approval');
    raise exception 'FAIL(commitment): manager approved a commitment';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000002')::text,true);
select app.decide_cost_commitment('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.commitment')::uuid,'approved','Contract accepted');
reset role;

-- Manager records an official invoice. Only the independent approver verifies it and records payment status.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000001')::text,true);
do $$ declare i uuid; begin
  i:=app.record_cost_invoice('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.item')::uuid,
    current_setting('sangam.t21.commitment')::uuid,'VENUE-INV-9',100000,18,'INR','2026-09-15');
  perform set_config('sangam.t21.invoice',i::text,false);
  begin
    perform app.verify_cost_invoice('21000000-0000-0000-0000-000000000101',i,'manager verification');
    raise exception 'FAIL(invoice): manager verified an invoice';
  exception when insufficient_privilege then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000002')::text,true);
select app.verify_cost_invoice('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.invoice')::uuid,'Invoice matched to commitment');
do $$ declare p uuid; begin
  p:=app.record_cost_payment('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.invoice')::uuid,
    50000,'2026-09-10','bank_transfer','OFFICIAL-REF-1');
  perform set_config('sangam.t21.payment',p::text,false);
  begin
    perform app.record_cost_payment('21000000-0000-0000-0000-000000000101',current_setting('sangam.t21.invoice')::uuid,
      70000,'2026-09-11','bank_transfer','OVERPAY');
    raise exception 'FAIL(payment): overpayment was accepted';
  exception when check_violation then null;
            when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

-- Authorized dashboard totals expose only official costs, split by currency, and no family-funding columns exist.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','21000000-0000-0000-0000-000000000001')::text,true);
do $$ begin
  if not exists(select 1 from app.cost_control_summary where wedding_id='21000000-0000-0000-0000-000000000101'
    and currency_code='INR' and approved_estimate_total=118000 and committed_total=118000
    and invoiced_total=118000 and paid_total=50000) then
    raise exception 'FAIL(summary): official totals are wrong or absent';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='app'
    and table_name in('cost_commitment','cost_invoice','cost_payment')
    and column_name in('host_group_id','funding_source','payer_family','contribution_amount','bank_account')) then
    raise exception 'FAIL(privacy): private funding field entered official Cost Control';
  end if;
end $$;
reset role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='app'
    and table_name in('cost_commitment','cost_invoice','cost_payment') and grantee='authenticated'
    and privilege_type in('INSERT','UPDATE','DELETE')) then
    raise exception 'FAIL(grants): official-cost tables expose direct DML';
  end if;
end $$;

select 'ALL OFFICIAL COST RECORD TESTS PASSED' as result;
rollback;
