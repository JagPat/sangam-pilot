-- 11_stay_rooms.sql — coverage for migration 0017 (Stay & Travel: rooms + rooming list).
-- Proves: the owner can set up a hotel/rooms and allocate a household with roommates; the room's capacity
-- is enforced; a room can't be double-booked and a household can't hold two active rooms; a guest can't be
-- a roommate in two active rooms; the occupancy views count correctly; cancelling frees the room; and a
-- non-owner sees nothing. Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('ff110000-0000-0000-0000-0000000000a0','stayowner@e.com'),
  ('ff110000-0000-0000-0000-0000000000c0','staymember@e.com');
insert into app.account(id,auth_user_id,email) values
  ('ffcc0000-0000-0000-0000-0000000000a0','ff110000-0000-0000-0000-0000000000a0','stayowner@e.com'),
  ('ffcc0000-0000-0000-0000-0000000000c0','ff110000-0000-0000-0000-0000000000c0','staymember@e.com');
insert into app.wedding(id,title) values ('ff000000-0000-0000-0000-000000000001','Stay Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('ff000000-0000-0000-0000-000000000001','ffcc0000-0000-0000-0000-0000000000a0','active'),
  ('ff000000-0000-0000-0000-000000000001','ffcc0000-0000-0000-0000-0000000000c0','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('ff000000-0000-0000-0000-000000000001','ffcc0000-0000-0000-0000-0000000000a0','wedding_owner',null);
insert into app.household(id,wedding_id,name) values
  ('ff000000-0000-0000-0000-0000000000a1','ff000000-0000-0000-0000-000000000001','HH One'),
  ('ff000000-0000-0000-0000-0000000000a2','ff000000-0000-0000-0000-000000000001','HH Two');
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('ff000000-0000-0000-0000-0000000000d1','ff000000-0000-0000-0000-000000000001','ff000000-0000-0000-0000-0000000000a1','G1'),
  ('ff000000-0000-0000-0000-0000000000d2','ff000000-0000-0000-0000-000000000001','ff000000-0000-0000-0000-0000000000a1','G2'),
  ('ff000000-0000-0000-0000-0000000000d3','ff000000-0000-0000-0000-000000000001','ff000000-0000-0000-0000-0000000000a1','G3'),
  ('ff000000-0000-0000-0000-0000000000d4','ff000000-0000-0000-0000-000000000001','ff000000-0000-0000-0000-0000000000a2','G4');

-- ============================ as the OWNER ============================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','ff110000-0000-0000-0000-0000000000a0')::text, true);

do $$
declare v_hotel uuid; v_double uuid; v_triple uuid; v_a1 uuid; v_a2 uuid; n int;
begin
  insert into app.hotel(wedding_id,name) values ('ff000000-0000-0000-0000-000000000001','The Grand') returning id into v_hotel;
  insert into app.room(wedding_id,hotel_id,label,room_type,capacity) values
    ('ff000000-0000-0000-0000-000000000001',v_hotel,'201','double',2) returning id into v_double;
  insert into app.room(wedding_id,hotel_id,label,room_type,capacity) values
    ('ff000000-0000-0000-0000-000000000001',v_hotel,'301','triple',3) returning id into v_triple;

  insert into app.room_allocation(wedding_id,room_id,household_id,status) values
    ('ff000000-0000-0000-0000-000000000001',v_double,'ff000000-0000-0000-0000-0000000000a1','held') returning id into v_a1;
  insert into app.room_occupant(wedding_id,allocation_id,guest_id) values
    ('ff000000-0000-0000-0000-000000000001',v_a1,'ff000000-0000-0000-0000-0000000000d1'),
    ('ff000000-0000-0000-0000-000000000001',v_a1,'ff000000-0000-0000-0000-0000000000d2');
  raise notice 'OK(setup): owner made a hotel + 2 rooms and seated 2 roommates in the double';

  begin
    insert into app.room_occupant(wedding_id,allocation_id,guest_id) values
      ('ff000000-0000-0000-0000-000000000001',v_a1,'ff000000-0000-0000-0000-0000000000d3');
    raise exception 'FAIL(capacity): a 3rd roommate fit into a 2-bed room';
  exception when sqlstate 'SA011' then null; end;
  raise notice 'OK(capacity): the double refused a 3rd roommate';

  select occupied_rooms into n from app.stay_summary where wedding_id='ff000000-0000-0000-0000-000000000001' and room_type='double';
  if n <> 1 then raise exception 'FAIL(view): double occupied_rooms=% (expected 1)', n; end if;
  select free_rooms into n from app.stay_summary where wedding_id='ff000000-0000-0000-0000-000000000001' and room_type='triple';
  if n <> 1 then raise exception 'FAIL(view): triple free_rooms=% (expected 1)', n; end if;
  raise notice 'OK(view): occupancy summary counts the double as occupied and the triple as free';

  begin
    insert into app.room_allocation(wedding_id,room_id,household_id,status) values
      ('ff000000-0000-0000-0000-000000000001',v_double,'ff000000-0000-0000-0000-0000000000a2','held');
    raise exception 'FAIL(room2x): the double took a second active allocation';
  exception when unique_violation then null; end;
  raise notice 'OK(room2x): a room cannot hold two active allocations';

  begin
    insert into app.room_allocation(wedding_id,room_id,household_id,status) values
      ('ff000000-0000-0000-0000-000000000001',v_triple,'ff000000-0000-0000-0000-0000000000a1','held');
    raise exception 'FAIL(hh2x): a household held two active rooms';
  exception when unique_violation then null; end;
  raise notice 'OK(hh2x): a household cannot hold two active rooms';

  insert into app.room_allocation(wedding_id,room_id,household_id,status) values
    ('ff000000-0000-0000-0000-000000000001',v_triple,'ff000000-0000-0000-0000-0000000000a2','held') returning id into v_a2;
  begin
    insert into app.room_occupant(wedding_id,allocation_id,guest_id) values
      ('ff000000-0000-0000-0000-000000000001',v_a2,'ff000000-0000-0000-0000-0000000000d1');
    raise exception 'FAIL(guest2x): a guest was seated in two active rooms';
  exception when sqlstate 'SA012' then null; end;
  raise notice 'OK(guest2x): a guest cannot be a roommate in two active rooms';

  update app.room_allocation set status='cancelled' where id=v_a1;
  insert into app.room_allocation(wedding_id,room_id,household_id,status) values
    ('ff000000-0000-0000-0000-000000000001',v_double,'ff000000-0000-0000-0000-0000000000a1','held');
  raise notice 'OK(release): cancelling an allocation frees the room to be re-let';
end $$;

-- ============================ a non-owner member sees nothing ============================
select set_config('request.jwt.claims', json_build_object('sub','ff110000-0000-0000-0000-0000000000c0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.room;            if n<>0 then raise exception 'FAIL(member): non-owner sees % rooms', n; end if;
  select count(*) into n from app.room_allocation; if n<>0 then raise exception 'FAIL(member): non-owner sees % allocations', n; end if;
  select count(*) into n from app.stay_summary;    if n<>0 then raise exception 'FAIL(member): non-owner sees % stay_summary rows', n; end if;
  raise notice 'OK(member): a non-owner member sees no rooms, allocations, or occupancy';
end $$;

reset role;
rollback;
