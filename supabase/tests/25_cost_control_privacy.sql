-- 25_cost_control_privacy.sql — Cost Control rejects explicit private-finance labels before writing.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('25000000-0000-0000-0000-000000000001','manager25@example.test'),
  ('25000000-0000-0000-0000-000000000002','approver25@example.test');
insert into app.account(id,auth_user_id,email) values
  ('25aa0000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000001','manager25@example.test'),
  ('25aa0000-0000-0000-0000-000000000002','25000000-0000-0000-0000-000000000002','approver25@example.test');
insert into app.wedding(id,title) values ('25000000-0000-0000-0000-000000000101','Cost privacy wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('25000000-0000-0000-0000-000000000101','25aa0000-0000-0000-0000-000000000001','active'),
  ('25000000-0000-0000-0000-000000000101','25aa0000-0000-0000-0000-000000000002','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('25000000-0000-0000-0000-000000000101','25aa0000-0000-0000-0000-000000000001','event_manager',null),
  ('25000000-0000-0000-0000-000000000101','25aa0000-0000-0000-0000-000000000002','cost_approver',null);
insert into app.cost_centre(id,wedding_id,template_key,name)
values ('25000000-0000-0000-0000-000000000201','25000000-0000-0000-0000-000000000101','decor','Decor');

-- Establish an ordinary approved estimate, commitment, and verified invoice.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000001')::text,false);
do $$ declare v_item uuid; v_estimate uuid; begin
  v_item:=app.create_cost_item('25000000-0000-0000-0000-000000000101','25000000-0000-0000-0000-000000000201','Stage decor','Stage floral installation',null,null,null);
  v_estimate:=app.save_cost_estimate_draft('25000000-0000-0000-0000-000000000101',v_item,null,
    jsonb_build_object('scope_included','Stage floral installation','subtotal',100000,'tax_rate',18,'currency_code','INR'));
  perform app.submit_cost_estimate('25000000-0000-0000-0000-000000000101',v_estimate);
  perform set_config('sangam.t25.item',v_item::text,false);
  perform set_config('sangam.t25.estimate',v_estimate::text,false);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000002')::text,false);
select app.begin_cost_review('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.estimate')::uuid);
select app.decide_cost_estimate('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.estimate')::uuid,'approved','Vendor scope accepted','under_review');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000001')::text,false);
do $$ declare v_commitment uuid; v_invoice uuid; begin
  v_commitment:=app.propose_cost_commitment('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.item')::uuid,
    current_setting('sangam.t25.estimate')::uuid,null,'Vendor quote DECOR-42','2026-09-01');
  perform set_config('sangam.t25.commitment',v_commitment::text,false);
  perform set_config('sangam.t25.ordinary_commitment',v_commitment::text,false);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000002')::text,false);
select app.decide_cost_commitment('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.commitment')::uuid,'approved','Vendor contract accepted');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000001')::text,false);
do $$ declare v_invoice uuid; begin
  v_invoice:=app.record_cost_invoice('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.item')::uuid,
    current_setting('sangam.t25.commitment')::uuid,'Vendor invoice INV-42',100000,18,'INR','2026-09-15');
  perform set_config('sangam.t25.invoice',v_invoice::text,false);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000002')::text,false);
select app.verify_cost_invoice('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.invoice')::uuid,'Invoice matched to vendor scope');
reset role;

-- Event-manager writes reject explicit labels and do not add a row.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000001')::text,false);
do $$ declare v_before integer; begin
  select count(*) into v_before from app.cost_estimate_version where wedding_id='25000000-0000-0000-0000-000000000101';
  begin
    perform app.save_cost_estimate_draft('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.item')::uuid,null,
      jsonb_build_object('scope_included','Bank account: 1234567890','scope_excluded','IFSC: HDFC0001234','remarks','Card number 4111 1111 1111 1111','subtotal',1,'tax_rate',0,'currency_code','INR'));
    raise exception 'FAIL(draft): prohibited privacy label was accepted';
  exception when sqlstate '22023' then null; when others then raise; end;
  if (select count(*) from app.cost_estimate_version where wedding_id='25000000-0000-0000-0000-000000000101')<>v_before then
    raise exception 'FAIL(draft): rejected input wrote an estimate';
  end if;

  select count(*) into v_before from app.cost_commitment where wedding_id='25000000-0000-0000-0000-000000000101';
  begin
    perform app.propose_cost_commitment('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.item')::uuid,
      current_setting('sangam.t25.estimate')::uuid,null,'Funding source: savings','2026-09-01');
    raise exception 'FAIL(commitment): prohibited privacy label was accepted';
  exception when sqlstate '22023' then null; when others then raise; end;
  if (select count(*) from app.cost_commitment where wedding_id='25000000-0000-0000-0000-000000000101')<>v_before then
    raise exception 'FAIL(commitment): rejected input wrote a commitment';
  end if;

  select count(*) into v_before from app.cost_invoice where wedding_id='25000000-0000-0000-0000-000000000101';
  begin
    perform app.record_cost_invoice('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.item')::uuid,
      current_setting('sangam.t25.commitment')::uuid,'Family settlement agreed privately',1,0,'INR',null);
    raise exception 'FAIL(invoice): prohibited privacy label was accepted';
  exception when sqlstate '22023' then null; when others then raise; end;
  if (select count(*) from app.cost_invoice where wedding_id='25000000-0000-0000-0000-000000000101')<>v_before then
    raise exception 'FAIL(invoice): rejected input wrote an invoice';
  end if;
end $$;
reset role;

-- The independent cost approver cannot put a prohibited label into payment status either.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','25000000-0000-0000-0000-000000000002')::text,false);
do $$ declare v_before integer; begin
  select count(*) into v_before from app.cost_payment where wedding_id='25000000-0000-0000-0000-000000000101';
  begin
    perform app.record_cost_payment('25000000-0000-0000-0000-000000000101',current_setting('sangam.t25.invoice')::uuid,
      1,'2026-09-10','bank_transfer','Bank account settlement');
    raise exception 'FAIL(payment): prohibited privacy label was accepted';
  exception when sqlstate '22023' then null; when others then raise; end;
  if (select count(*) from app.cost_payment where wedding_id='25000000-0000-0000-0000-000000000101')<>v_before then
    raise exception 'FAIL(payment): rejected input wrote a payment';
  end if;
end $$;
reset role;

select 'ALL COST CONTROL PRIVACY TESTS PASSED' as result;
rollback;
