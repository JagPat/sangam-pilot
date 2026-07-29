-- 23_wedding_date_range.sql — impossible wedding ranges are rejected by both the table and creator RPC.
\set ON_ERROR_STOP on
begin;

insert into app.wedding(id,title,start_date,end_date) values
  ('23000000-0000-0000-0000-000000000001','Same-day wedding','2026-11-22','2026-11-22'),
  ('23000000-0000-0000-0000-000000000002','Open-ended wedding','2026-11-22',null);

do $$ begin
  begin
    insert into app.wedding(id,title,start_date,end_date)
    values ('23000000-0000-0000-0000-000000000003','Impossible wedding','2026-11-22','2026-07-26');
    raise exception 'FAIL(constraint): reversed wedding dates reached the table';
  exception when check_violation then null;
            when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

insert into auth.users(id,email)
values ('23000000-0000-0000-0000-000000000010','date-planner@example.test');
insert into app.account(id,auth_user_id,email,can_create_wedding)
values ('23aa0000-0000-0000-0000-000000000010','23000000-0000-0000-0000-000000000010','date-planner@example.test',true);

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','23000000-0000-0000-0000-000000000010')::text,true);
do $$ begin
  begin
    perform app.create_wedding('Impossible RPC wedding',null,'Asia/Kolkata','2026-11-22','2026-07-26');
    raise exception 'FAIL(rpc): create_wedding accepted a reversed date range';
  exception when invalid_parameter_value then null;
            when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

select 'ALL WEDDING DATE-RANGE TESTS PASSED' as result;
rollback;
