-- 05_slice1_schedule.sql — ADDITIVE Slice-1 read-path coverage (does not modify the accepted v8 suites).
-- Proves the exact queries app/lib/data/schedule.ts runs (invitation_guest, event_instance, event_function,
-- venue, event_attendance, guest) return the signed-in guest's OWN invited events under RLS — and nothing
-- else. Runs AS the `authenticated` role. Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values
  ('6a6a6a6a-0000-0000-0000-0000000000a0'),   -- owner
  ('6d6d6d6d-0000-0000-0000-0000000000d0')    -- the signed-in guest
  on conflict do nothing;

insert into app.wedding(id,title) values ('66666666-0000-0000-0000-000000000001','W');
insert into app.account(id,auth_user_id) values
  ('66666666-0000-0000-0000-0000000000a0','6a6a6a6a-0000-0000-0000-0000000000a0'),
  ('66666666-0000-0000-0000-0000000000d0','6d6d6d6d-0000-0000-0000-0000000000d0');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-0000000000a0','active'),
  ('66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-0000000000d0','active');
insert into app.operator_role(wedding_id,account_id,role) values
  ('66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-0000000000a0','wedding_owner');

insert into app.household(id,wedding_id,name) values ('66666666-0000-0000-0000-000000000011','66666666-0000-0000-0000-000000000001','H');
insert into app.guest(id,wedding_id,household_id,full_name,self_account_id) values
  ('66666666-0000-0000-0000-000000000021','66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000011','Jaya','66666666-0000-0000-0000-0000000000d0'),
  ('66666666-0000-0000-0000-000000000022','66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000011','Someone Else',null);

insert into app.event_function(id,wedding_id,name,type) values ('66666666-0000-0000-0000-000000000031','66666666-0000-0000-0000-000000000001','Sangeet','sangeet');
insert into app.venue(id,wedding_id,name,iana_timezone) values ('66666666-0000-0000-0000-000000000041','66666666-0000-0000-0000-000000000001','The Grand Bhagwati','Asia/Kolkata');
insert into app.event_instance(id,wedding_id,event_function_id,venue_id,iana_timezone,arrival) values
  ('66666666-0000-0000-0000-000000000051','66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000031','66666666-0000-0000-0000-000000000041','Asia/Kolkata',row(now(),now()::timestamp,330,'host')::app.zoned_time),
  ('66666666-0000-0000-0000-000000000052','66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000031',null,'Asia/Kolkata',row(now(),now()::timestamp,330,'host')::app.zoned_time);  -- UNINVITED instance

insert into app.invitation(id,wedding_id,household_id,event_instance_id,status) values
  ('66666666-0000-0000-0000-000000000061','66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000011','66666666-0000-0000-0000-000000000051','sent');
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('66666666-0000-0000-0000-000000000071','66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000061','66666666-0000-0000-0000-000000000051','66666666-0000-0000-0000-000000000021');
insert into app.event_attendance(wedding_id,invitation_guest_id,status,responded_as) values
  ('66666666-0000-0000-0000-000000000001','66666666-0000-0000-0000-000000000071','accepted','self');

-- ===== AS the signed-in guest: the schedule read path returns exactly their invited event =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','6d6d6d6d-0000-0000-0000-0000000000d0')::text, true);
do $$
declare n int; v_inst uuid; v_fname text; v_vname text; v_status app.attendance_status; v_gname text;
begin
  -- invitation_guest: exactly the one the guest can act for
  select count(*) into n from app.invitation_guest;
  if n <> 1 then raise exception 'FAIL: expected 1 invitation_guest for the guest, got %', n; end if;
  select event_instance_id into v_inst from app.invitation_guest limit 1;
  if v_inst <> '66666666-0000-0000-0000-000000000051' then raise exception 'FAIL: wrong invited instance'; end if;

  -- event_instance: only the invited instance is visible (uninvited one is hidden by RLS)
  select count(*) into n from app.event_instance;
  if n <> 1 then raise exception 'FAIL: guest sees % event_instance rows (expected only their invited one)', n; end if;
  select count(*) into n from app.event_instance where id='66666666-0000-0000-0000-000000000052';
  if n <> 0 then raise exception 'FAIL: guest could read an UNINVITED event_instance'; end if;

  -- event_function + venue for the invited instance are readable
  select name into v_fname from app.event_function where id='66666666-0000-0000-0000-000000000031';
  if v_fname is distinct from 'Sangeet' then raise exception 'FAIL: function not readable for invited instance'; end if;
  select name into v_vname from app.venue where id='66666666-0000-0000-0000-000000000041';
  if v_vname is distinct from 'The Grand Bhagwati' then raise exception 'FAIL: venue not readable for invited instance'; end if;

  -- their own attendance status is readable; the guest row is readable (self)
  select status into v_status from app.event_attendance where invitation_guest_id='66666666-0000-0000-0000-000000000071';
  if v_status <> 'accepted' then raise exception 'FAIL: own attendance status not readable (got %)', v_status; end if;
  select full_name into v_gname from app.guest where id='66666666-0000-0000-0000-000000000021';
  if v_gname is distinct from 'Jaya' then raise exception 'FAIL: guest cannot read their own guest row'; end if;

  -- another household member the guest was not invited alongside is NOT leaked
  select count(*) into n from app.guest where id='66666666-0000-0000-0000-000000000022';
  if n <> 0 then raise exception 'FAIL: guest read an unrelated guest row (contact leak)'; end if;

  raise notice 'OK: schedule read path returns exactly the guest''s invited event (function+venue+status), no uninvited/other rows';
end $$;
reset role;

select 'ALL SLICE-1 SCHEDULE TESTS PASSED' as result;
rollback;
