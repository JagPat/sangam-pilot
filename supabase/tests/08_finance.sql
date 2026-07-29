-- 08_finance.sql — regression: the superseded family/private finance MVP is sealed.
\set ON_ERROR_STOP on
begin;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='app'
    and table_name in('finance_expense','finance_expense_allocation','finance_cost_item','finance_funding_signal','finance_net_position','finance_funding_status')
    and grantee in('anon','authenticated')) then
    raise exception 'FAIL(retired-finance): a client table/view grant remains';
  end if;
  if exists(select 1 from information_schema.role_routine_grants where routine_schema='app'
    and routine_name in('owner_add_expense','owner_update_expense','owner_delete_expense','manager_add_cost','manager_update_cost','manager_cancel_cost','finance_admin_publish_signal')
    and grantee in('PUBLIC','anon','authenticated','service_role')) then
    raise exception 'FAIL(retired-finance): a client/service routine grant remains';
  end if;
end $$;

set local role anon;
do $$ begin
  begin perform count(*) from app.finance_expense; raise exception 'FAIL(anon): private finance readable';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;

select 'ALL RETIRED-FINANCE TESTS PASSED' as result;
rollback;
