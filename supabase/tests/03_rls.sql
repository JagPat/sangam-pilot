-- 03_rls.sql — ADVERSARIAL tests that run as the `authenticated` role (RLS enforced), not superuser.
-- Regression coverage for the two P0 authorization holes plus positive cases.
-- Requires: roles from 00_roles.sql, the auth stub (auth.uid + auth.users), migrations + grants applied.
\set ON_ERROR_STOP on
begin;

-- ids (all valid hex). W=wedding OA/MA/PA/GA=accounts HH=household G1/2/3=guests F1/X1=function/instance
-- I1=invitation IG1/IG3=invitation_guests
insert into auth.users(id) values
  ('a0a0a0a0-0000-0000-0000-0000000000a0'),  -- owner login
  ('c0c0c0c0-0000-0000-0000-0000000000c0'),  -- ordinary member login (NOT invited, not a guest)
  ('b0b0b0b0-0000-0000-0000-0000000000b0'),  -- proxy login
  ('d0d0d0d0-0000-0000-0000-0000000000d0')   -- invited guest's login
  on conflict do nothing;

insert into app.wedding(id,title) values ('44444444-0000-0000-0000-000000000001','W');
insert into app.account(id,auth_user_id) values
  ('44444444-0000-0000-0000-0000000000a0','a0a0a0a0-0000-0000-0000-0000000000a0'),
  ('44444444-0000-0000-0000-0000000000c0','c0c0c0c0-0000-0000-0000-0000000000c0'),
  ('44444444-0000-0000-0000-0000000000b0','b0b0b0b0-0000-0000-0000-0000000000b0'),
  ('44444444-0000-0000-0000-0000000000d0','d0d0d0d0-0000-0000-0000-0000000000d0');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-0000000000a0','active'),
  ('44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-0000000000c0','active'),
  ('44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-0000000000b0','active'),
  ('44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-0000000000d0','active');
insert into app.operator_role(wedding_id,account_id,role) values
  ('44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-0000000000a0','wedding_owner');

insert into app.household(id,wedding_id,name) values ('44444444-0000-0000-0000-000000000011','44444444-0000-0000-0000-000000000001','H');
insert into app.guest(id,wedding_id,household_id,full_name,self_account_id,show_in_directory) values
  ('44444444-0000-0000-0000-000000000021','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000011','Invited','44444444-0000-0000-0000-0000000000d0', true),
  ('44444444-0000-0000-0000-000000000022','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000011','Hidden',  null, false),
  ('44444444-0000-0000-0000-000000000023','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000011','Elder',   null, true);
insert into app.guest_delegation(wedding_id,guest_id,account_id,capabilities) values
  ('44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000023','44444444-0000-0000-0000-0000000000b0','{rsvp,view_schedule}');

insert into app.event_function(id,wedding_id,name,type) values ('44444444-0000-0000-0000-000000000031','44444444-0000-0000-0000-000000000001','Sangeet','sangeet');
insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival) values
  ('44444444-0000-0000-0000-000000000041','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000031','Asia/Kolkata',
   row(now(),now()::timestamp,330,'host')::app.zoned_time);
insert into app.invitation(id,wedding_id,household_id,event_instance_id,status) values
  ('44444444-0000-0000-0000-000000000051','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000011','44444444-0000-0000-0000-000000000041','sent');
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('44444444-0000-0000-0000-000000000061','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000051','44444444-0000-0000-0000-000000000041','44444444-0000-0000-0000-000000000021'),
  ('44444444-0000-0000-0000-000000000063','44444444-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000051','44444444-0000-0000-0000-000000000041','44444444-0000-0000-0000-000000000023');
-- guest ...022 (Hidden) is deliberately NOT invited.

-- ===== P0 #1: an ordinary member must NOT read an uninvited event or a hidden guest =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','c0c0c0c0-0000-0000-0000-0000000000c0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.event_instance where id='44444444-0000-0000-0000-000000000041';
  if n <> 0 then raise exception 'FAIL(P0-1a): ordinary member read an uninvited event (% rows)', n; end if;
  select count(*) into n from app.guest where id='44444444-0000-0000-0000-000000000022';
  if n <> 0 then raise exception 'FAIL(P0-1b): ordinary member read a directory-hidden guest'; end if;
  select count(*) into n from app.directory_entry where guest_id='44444444-0000-0000-0000-000000000022';
  if n <> 0 then raise exception 'FAIL(P0-1b): hidden guest appeared in the directory'; end if;
  select count(*) into n from app.directory_entry where guest_id='44444444-0000-0000-0000-000000000021';
  if n <> 1 then raise exception 'FAIL: a directory-visible guest was missing from the directory (%)', n; end if;
  select count(*) into n from app.guest where id='44444444-0000-0000-0000-000000000021';
  if n <> 0 then raise exception 'FAIL: member read a base guest row (contact leak) via directory visibility'; end if;
  raise notice 'OK(P0-1): ordinary member blocked from uninvited event + hidden guest + base guest rows';
end $$;
reset role;

-- ===== positive: an invited guest CAN see their own instance =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','d0d0d0d0-0000-0000-0000-0000000000d0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.event_instance where id='44444444-0000-0000-0000-000000000041';
  if n <> 1 then raise exception 'FAIL: invited guest could not see their own instance (%)', n; end if;
  raise notice 'OK: invited guest sees their own instance';
end $$;
reset role;

-- ===== positive: an ACTIVE proxy may propose =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','b0b0b0b0-0000-0000-0000-0000000000b0')::text, true);
do $$ declare pid uuid; v_auth app.rsvp_authority; v_chan app.rsvp_channel; begin
  pid := public.propose_rsvp_change('44444444-0000-0000-0000-000000000063'::uuid,'accepted'::app.attendance_status);
  if pid is null then raise exception 'FAIL: active proxy could not propose'; end if;
  perform public.confirm_rsvp_change(pid);
  select responded_as, responded_channel into v_auth, v_chan
    from app.event_attendance where invitation_guest_id='44444444-0000-0000-0000-000000000063';
  if v_auth <> 'delegate' then raise exception 'FAIL: authority not DERIVED as delegate (got %)', v_auth; end if;
  if v_chan <> 'web' then raise exception 'FAIL: channel not web via the authenticated wrapper (got %)', v_chan; end if;
  raise notice 'OK: active delegate proposed+confirmed; authority DERIVED as delegate, channel web (not caller-set)';
end $$;
reset role;

-- ===== P0 #2: revoke the proxy's membership -> proposing must now be DENIED =====
update app.wedding_membership set status='revoked'
  where wedding_id='44444444-0000-0000-0000-000000000001' and account_id='44444444-0000-0000-0000-0000000000b0';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','b0b0b0b0-0000-0000-0000-0000000000b0')::text, true);
do $$ begin
  begin
    perform public.propose_rsvp_change('44444444-0000-0000-0000-000000000063'::uuid,'accepted'::app.attendance_status);
    raise exception 'FAIL(P0-2): revoked-membership proxy was allowed to propose an RSVP';
  exception when others then
    if sqlerrm like 'FAIL(P0-2)%' then raise; end if;
    raise notice 'OK(P0-2): revoked-membership proxy blocked (%)', sqlerrm;
  end;
end $$;
reset role;

select 'ALL RLS TESTS PASSED' as result;
rollback;
