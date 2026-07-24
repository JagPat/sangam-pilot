-- 12_stay_travel.sql — coverage for migration 0018 (guest self-service: stay requests + travel).
-- Proves: a signed-in guest can create/read their own household's stay_request and their own travel, and
-- see their own room via my_stay(); they cannot read or write another household's stay_request or another
-- guest's travel, and my_stay() shows only their own room; the owner sees everything. Requires 00_roles +
-- auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('fb110000-0000-0000-0000-0000000000a0','stayowner@e.com'),
  ('fb110000-0000-0000-0000-0000000000b1','guest1@e.com'),
  ('fb110000-0000-0000-0000-0000000000b2','guest2@e.com');
insert into app.account(id,auth_user_id,email) values
  ('fbcc0000-0000-0000-0000-0000000000a0','fb110000-0000-0000-0000-0000000000a0','stayowner@e.com'),
  ('fbcc0000-0000-0000-0000-0000000000b1','fb110000-0000-0000-0000-0000000000b1','guest1@e.com'),
  ('fbcc0000-0000-0000-0000-0000000000b2','fb110000-0000-0000-0000-0000000000b2','guest2@e.com');
insert into app.wedding(id,title) values ('fb000000-0000-0000-0000-000000000001','ST Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('fb000000-0000-0000-0000-000000000001','fbcc0000-0000-0000-0000-0000000000a0','active'),
  ('fb000000-0000-0000-0000-000000000001','fbcc0000-0000-0000-0000-0000000000b1','active'),
  ('fb000000-0000-0000-0000-000000000001','fbcc0000-0000-0000-0000-0000000000b2','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('fb000000-0000-0000-0000-000000000001','fbcc0000-0000-0000-0000-0000000000a0','wedding_owner',null);
insert into app.household(id,wedding_id,name) values
  ('fb000000-0000-0000-0000-0000000000a1','fb000000-0000-0000-0000-000000000001','HH One'),
  ('fb000000-0000-0000-0000-0000000000a2','fb000000-0000-0000-0000-000000000001','HH Two');
insert into app.guest(id,wedding_id,household_id,full_name,self_account_id) values
  ('fb000000-0000-0000-0000-0000000000d1','fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000a1','Guest One','fbcc0000-0000-0000-0000-0000000000b1'),
  ('fb000000-0000-0000-0000-0000000000d2','fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000a2','Guest Two','fbcc0000-0000-0000-0000-0000000000b2');

-- ===== owner: set up a room, allocate HH One + seat Guest One, and record HH Two's stay ask =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','fb110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare v_hotel uuid; v_room uuid; v_a uuid; begin
  insert into app.hotel(wedding_id,name) values ('fb000000-0000-0000-0000-000000000001','Hotel') returning id into v_hotel;
  insert into app.room(wedding_id,hotel_id,label,room_type,capacity) values
    ('fb000000-0000-0000-0000-000000000001',v_hotel,'101','double',2) returning id into v_room;
  insert into app.room_allocation(wedding_id,room_id,household_id,status) values
    ('fb000000-0000-0000-0000-000000000001',v_room,'fb000000-0000-0000-0000-0000000000a1','confirmed') returning id into v_a;
  insert into app.room_occupant(wedding_id,allocation_id,guest_id) values
    ('fb000000-0000-0000-0000-000000000001',v_a,'fb000000-0000-0000-0000-0000000000d1');
  insert into app.stay_request(wedding_id,household_id,status) values
    ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000a2','needs_room');
  raise notice 'OK(setup): owner seated Guest One and logged HH Two as needs_room';
end $$;

-- ===== Guest One: manage own, blocked from others, sees own room =====
select set_config('request.jwt.claims', json_build_object('sub','fb110000-0000-0000-0000-0000000000b1')::text, true);
do $$ declare n int; begin
  insert into app.stay_request(wedding_id,household_id,status,nights) values
    ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000a1','allocated',2);
  insert into app.travel_detail(wedding_id,guest_id,direction,mode,number) values
    ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000d1','arrival','flight','6E-203');
  select count(*) into n from app.stay_request;  if n<>1 then raise exception 'FAIL(read): guest sees % stay_requests (expected only their 1)', n; end if;
  select count(*) into n from app.travel_detail; if n<>1 then raise exception 'FAIL(read): guest sees % travel rows (expected 1)', n; end if;
  select count(*) into n from app.stay_request where household_id='fb000000-0000-0000-0000-0000000000a2'; if n<>0 then raise exception 'FAIL(leak): guest sees HH Two stay_request'; end if;
  select count(*) into n from app.my_stay();      if n<>1 then raise exception 'FAIL(mystay): guest sees % rooms (expected 1)', n; end if;
  raise notice 'OK(guest1): created own stay+travel, sees only own (1 each), my_stay shows their room';

  begin
    insert into app.stay_request(wedding_id,household_id,status) values ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000a2','needs_room');
    raise exception 'FAIL(cross): guest wrote HH Two stay_request';
  exception when insufficient_privilege then null; when unique_violation then raise exception 'FAIL(cross): reached unique check (should have been RLS-denied)'; end;
  begin
    insert into app.travel_detail(wedding_id,guest_id,direction,mode) values ('fb000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-0000000000d2','arrival','car');
    raise exception 'FAIL(cross): guest wrote another guest travel';
  exception when insufficient_privilege then null; end;
  raise notice 'OK(guest1): refused writing HH Two stay_request and Guest Two travel';
end $$;

-- ===== Guest Two: sees only own, no room yet =====
select set_config('request.jwt.claims', json_build_object('sub','fb110000-0000-0000-0000-0000000000b2')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.my_stay();     if n<>0 then raise exception 'FAIL(mystay2): unallocated guest sees % rooms', n; end if;
  select count(*) into n from app.stay_request;  if n<>1 then raise exception 'FAIL(read2): guest2 sees % stay_requests (expected their 1)', n; end if;
  select count(*) into n from app.stay_request where household_id='fb000000-0000-0000-0000-0000000000a1'; if n<>0 then raise exception 'FAIL(leak2): guest2 sees HH One stay_request'; end if;
  raise notice 'OK(guest2): sees only their own stay_request; my_stay empty (not allocated)';
end $$;

-- ===== owner sees everything =====
select set_config('request.jwt.claims', json_build_object('sub','fb110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.stay_request;  if n<>2 then raise exception 'FAIL(owner): owner sees % stay_requests (expected 2)', n; end if;
  select count(*) into n from app.travel_detail; if n<>1 then raise exception 'FAIL(owner): owner sees % travel rows (expected 1)', n; end if;
  raise notice 'OK(owner): owner sees both stay_requests and the travel row';
end $$;

reset role;
rollback;
