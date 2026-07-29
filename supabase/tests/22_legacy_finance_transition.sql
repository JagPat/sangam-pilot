-- 22_legacy_finance_transition.sql — old finance is sealed; only non-private operational costs convert.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values ('22000000-0000-0000-0000-000000000001','manager22@example.test');
insert into app.account(id,auth_user_id,email) values ('22aa0000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','manager22@example.test');
insert into app.wedding(id,title) values ('22000000-0000-0000-0000-000000000101','Transition wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values ('22000000-0000-0000-0000-000000000101','22aa0000-0000-0000-0000-000000000001','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values ('22000000-0000-0000-0000-000000000101','22aa0000-0000-0000-0000-000000000001','event_manager',null);
insert into app.host_group(id,wedding_id,kind,name) values ('22000000-0000-0000-0000-000000000201','22000000-0000-0000-0000-000000000101','bride_family','Bride family');
insert into app.finance_cost_item(id,wedding_id,description,category,amount,currency_code,payment_status,paid_at,created_by_account_id)
values
 ('22000000-0000-0000-0000-000000000301','22000000-0000-0000-0000-000000000101','Official venue target','venue',500000,'INR','planned',null,'22aa0000-0000-0000-0000-000000000001'),
 ('22000000-0000-0000-0000-000000000302','22000000-0000-0000-0000-000000000101','Private contribution','family',100000,'INR','paid','2026-07-01','22aa0000-0000-0000-0000-000000000001');
insert into app.finance_expense(id,wedding_id,cost_item_id,description,category,amount,currency_code,paid_at,paid_by_host_group_id,created_by_account_id)
values('22000000-0000-0000-0000-000000000401','22000000-0000-0000-0000-000000000101','22000000-0000-0000-0000-000000000302','Private contribution','family',100000,'INR','2026-07-01','22000000-0000-0000-0000-000000000201','22aa0000-0000-0000-0000-000000000001');

select app.convert_legacy_cost_control();

do $$ begin
  if not exists(select 1 from app.legacy_cost_control_conversion m join app.cost_item i on i.id=m.cost_item_id
    join app.cost_estimate_version e on e.cost_item_id=i.id
    where m.legacy_finance_cost_item_id='22000000-0000-0000-0000-000000000301'
      and m.outcome='converted' and i.title='Official venue target' and e.origin='legacy_import' and e.state='submitted' and e.total=500000) then
    raise exception 'FAIL(conversion): official operational target was not staged for approval';
  end if;
  if exists(select 1 from app.cost_item where wedding_id='22000000-0000-0000-0000-000000000101' and title='Private contribution') then
    raise exception 'FAIL(privacy): private contribution was copied into Cost Control';
  end if;
  if not exists(select 1 from app.legacy_cost_control_conversion where legacy_finance_cost_item_id='22000000-0000-0000-0000-000000000302' and outcome='excluded_private') then
    raise exception 'FAIL(conversion): excluded private twin was not accounted for';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','22000000-0000-0000-0000-000000000001')::text,true);
do $$ begin
  begin perform count(*) from app.finance_cost_item; raise exception 'FAIL(seal): authenticated read retired operational finance';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform count(*) from app.finance_expense; raise exception 'FAIL(seal): authenticated read private family finance';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform app.manager_add_cost('22000000-0000-0000-0000-000000000101','Sneaky','misc',1,'INR',null,'planned',null,null);
    raise exception 'FAIL(seal): authenticated wrote retired finance';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;

select 'ALL LEGACY FINANCE TRANSITION TESTS PASSED' as result;
rollback;
