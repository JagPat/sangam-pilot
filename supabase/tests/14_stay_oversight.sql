-- 14_stay_oversight.sql — coverage for migration 0020 (family-admin stay oversight + activity log).
-- Proves a bride-side admin can READ their own side's rooms / stay requests / travel / services and the
-- activity entries for their side (plus wedding-level ones), but cannot see the groom side's, cannot write
-- stay, and cannot read groom-side activity; the owner sees everything. Requires 00_roles + auth stub +
-- migrations/grants (through 0020).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('fc110000-0000-0000-0000-0000000000a0','ov@ov.com'),
  ('fc110000-0000-0000-0000-0000000000b1','bride@ov.com'),
  ('fc110000-0000-0000-0000-0000000000c1','groom@ov.com');
insert into app.account(id,auth_user_id,email) values
  ('fcc00000-0000-0000-0000-0000000000a0','fc110000-0000-0000-0000-0000000000a0','ov@ov.com'),
  ('fcc00000-0000-0000-0000-0000000000b1','fc110000-0000-0000-0000-0000000000b1','bride@ov.com'),
  ('fcc00000-0000-0000-0000-0000000000c1','fc110000-0000-0000-0000-0000000000c1','groom@ov.com');
insert into app.wedding(id,title) values ('fc000000-0000-0000-0000-000000000001','OV Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('fc000000-0000-0000-0000-000000000001','fcc00000-0000-0000-0000-0000000000a0','active'),
  ('fc000000-0000-0000-0000-000000000001','fcc00000-0000-0000-0000-0000000000b1','active'),
  ('fc000000-0000-0000-0000-000000000001','fcc00000-0000-0000-0000-0000000000c1','active');
insert into app.host_group(id,wedding_id,kind,name) values
  ('fc000000-0000-0000-0000-0000000000bf','fc000000-0000-0000-0000-000000000001','bride_family','Bride family'),
  ('fc000000-0000-0000-0000-0000000000cf','fc000000-0000-0000-0000-000000000001','groom_family','Groom family');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('fc000000-0000-0000-0000-000000000001','fcc00000-0000-0000-0000-0000000000a0','wedding_owner',null),
  ('fc000000-0000-0000-0000-000000000001','fcc00000-0000-0000-0000-0000000000b1','host_group_admin','fc000000-0000-0000-0000-0000000000bf'),
  ('fc000000-0000-0000-0000-000000000001','fcc00000-0000-0000-0000-0000000000c1','host_group_admin','fc000000-0000-0000-0000-0000000000cf');
insert into app.household(id,wedding_id,name,host_group_id) values
  ('fc000000-0000-0000-0000-0000000000b8','fc000000-0000-0000-0000-000000000001','Bride HH','fc000000-0000-0000-0000-0000000000bf'),
  ('fc000000-0000-0000-0000-0000000000c8','fc000000-0000-0000-0000-000000000001','Groom HH','fc000000-0000-0000-0000-0000000000cf');
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('fc000000-0000-0000-0000-0000000000b9','fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-0000000000b8','Bride Guest'),
  ('fc000000-0000-0000-0000-0000000000c9','fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-0000000000c8','Groom Guest');

-- ===== owner builds the stay data for BOTH sides and writes three activity entries =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','fc110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare v_hotel uuid; v_rb uuid; v_rg uuid; v_ab uuid; v_ag uuid; v_svc uuid; begin
  insert into app.hotel(wedding_id,name) values ('fc000000-0000-0000-0000-000000000001','Hotel') returning id into v_hotel;
  insert into app.room(wedding_id,hotel_id,label,room_type,capacity) values
    ('fc000000-0000-0000-0000-000000000001',v_hotel,'201','double',2) returning id into v_rb;
  insert into app.room(wedding_id,hotel_id,label,room_type,capacity) values
    ('fc000000-0000-0000-0000-000000000001',v_hotel,'202','double',2) returning id into v_rg;
  insert into app.room_allocation(wedding_id,room_id,household_id,status) values
    ('fc000000-0000-0000-0000-000000000001',v_rb,'fc000000-0000-0000-0000-0000000000b8','confirmed') returning id into v_ab;
  insert into app.room_allocation(wedding_id,room_id,household_id,status) values
    ('fc000000-0000-0000-0000-000000000001',v_rg,'fc000000-0000-0000-0000-0000000000c8','confirmed') returning id into v_ag;
  insert into app.room_occupant(wedding_id,allocation_id,guest_id) values
    ('fc000000-0000-0000-0000-000000000001',v_ab,'fc000000-0000-0000-0000-0000000000b9'),
    ('fc000000-0000-0000-0000-000000000001',v_ag,'fc000000-0000-0000-0000-0000000000c9');
  insert into app.stay_request(wedding_id,household_id,status) values
    ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-0000000000b8','allocated'),
    ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-0000000000c8','allocated');
  insert into app.travel_detail(wedding_id,guest_id,direction,mode) values
    ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-0000000000b9','arrival','flight'),
    ('fc000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-0000000000c9','arrival','train');
  insert into app.service(wedding_id,name,billing,scope) values
    ('fc000000-0000-0000-0000-000000000001','Spa','guest_paid','per_person') returning id into v_svc;
  insert into app.service_request(wedding_id,service_id,household_id,guest_id,qty) values
    ('fc000000-0000-0000-0000-000000000001',v_svc,'fc000000-0000-0000-0000-0000000000b8','fc000000-0000-0000-0000-0000000000b9',1),
    ('fc000000-0000-0000-0000-000000000001',v_svc,'fc000000-0000-0000-0000-0000000000c8','fc000000-0000-0000-0000-0000000000c9',1);
  perform app.log_stay_activity('fc000000-0000-0000-0000-000000000001','room_allocated','Room 201 → Bride HH','fc000000-0000-0000-0000-0000000000b8',null);
  perform app.log_stay_activity('fc000000-0000-0000-0000-000000000001','room_allocated','Room 202 → Groom HH','fc000000-0000-0000-0000-0000000000c8',null);
  perform app.log_stay_activity('fc000000-0000-0000-0000-000000000001','service_added','Added Spa to the menu',null,null);
  raise notice 'OK(setup): owner built both sides'' stay data + 3 activity entries';
end $$;

-- ===== bride admin: own side visible, groom side hidden =====
select set_config('request.jwt.claims', json_build_object('sub','fc110000-0000-0000-0000-0000000000b1')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.room_allocation; if n<>1 then raise exception 'FAIL(alloc): bride admin sees % allocations (expected their 1)', n; end if;
  select count(*) into n from app.room_occupant;   if n<>1 then raise exception 'FAIL(occ): bride admin sees % occupants (expected 1)', n; end if;
  select count(*) into n from app.stay_request;    if n<>1 then raise exception 'FAIL(req): bride admin sees % stay_requests (expected 1)', n; end if;
  select count(*) into n from app.travel_detail;   if n<>1 then raise exception 'FAIL(travel): bride admin sees % travel rows (expected 1)', n; end if;
  select count(*) into n from app.service_request; if n<>1 then raise exception 'FAIL(svcreq): bride admin sees % service_requests (expected 1)', n; end if;
  select count(*) into n from app.room;            if n<>2 then raise exception 'FAIL(room): bride admin sees % rooms (expected shared 2)', n; end if;
  select count(*) into n from app.stay_request where household_id='fc000000-0000-0000-0000-0000000000c8'; if n<>0 then raise exception 'FAIL(leak): bride admin sees GROOM stay_request'; end if;
  raise notice 'OK(bride-read): sees only their side (alloc/occ/req/travel/service = 1 each) + shared rooms; groom hidden';
end $$;

-- ===== bride admin: cannot write stay =====
do $$ declare n int; begin
  begin
    insert into app.room_allocation(wedding_id,room_id,household_id,status)
      select 'fc000000-0000-0000-0000-000000000001', id, 'fc000000-0000-0000-0000-0000000000b8','held' from app.room limit 1;
    raise exception 'FAIL(write): bride admin inserted a room_allocation';
  exception when insufficient_privilege then null; when unique_violation then raise exception 'FAIL(write): reached unique check (should be RLS-denied)'; end;
  update app.stay_request set status='cancelled' where household_id='fc000000-0000-0000-0000-0000000000b8';
  get diagnostics n = row_count; if n<>0 then raise exception 'FAIL(write): bride admin updated % stay_request rows', n; end if;
  raise notice 'OK(bride-write): read-only — cannot allocate or edit stay';
end $$;

-- ===== activity log scoping: bride sees their entry + wedding-level, not groom's =====
do $$ declare n int; begin
  select count(*) into n from app.stay_activity; if n<>2 then raise exception 'FAIL(log): bride admin sees % activity rows (expected bride + wedding-level = 2)', n; end if;
  select count(*) into n from app.stay_activity where household_id='fc000000-0000-0000-0000-0000000000c8'; if n<>0 then raise exception 'FAIL(log-leak): bride admin sees a GROOM activity entry'; end if;
  raise notice 'OK(bride-log): sees own-side + wedding-level activity, not the groom entry';
end $$;

-- ===== groom admin: mirror-image isolation =====
select set_config('request.jwt.claims', json_build_object('sub','fc110000-0000-0000-0000-0000000000c1')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.stay_request where household_id='fc000000-0000-0000-0000-0000000000c8'; if n<>1 then raise exception 'FAIL(groom): groom admin cannot see own stay_request'; end if;
  select count(*) into n from app.stay_request where household_id='fc000000-0000-0000-0000-0000000000b8'; if n<>0 then raise exception 'FAIL(groom-leak): groom admin sees BRIDE stay_request'; end if;
  select count(*) into n from app.stay_activity; if n<>2 then raise exception 'FAIL(groom-log): groom admin sees % activity rows (expected groom + wedding-level)', n; end if;
  raise notice 'OK(groom): mirror isolation — own side + wedding-level only';
end $$;

-- ===== owner: sees everything =====
select set_config('request.jwt.claims', json_build_object('sub','fc110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.room_allocation; if n<>2 then raise exception 'FAIL(owner): owner sees % allocations (expected 2)', n; end if;
  select count(*) into n from app.stay_activity;   if n<>3 then raise exception 'FAIL(owner): owner sees % activity rows (expected 3)', n; end if;
  raise notice 'OK(owner): owner sees both sides + the full activity log';
end $$;

reset role;
rollback;
