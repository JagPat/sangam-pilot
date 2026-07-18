-- 02_rsvp_flow.sql — propose/confirm, count consistency, proxy attribution, optimistic concurrency.
-- Requires the Supabase auth schema (auth.uid() + request.jwt.claims). Run against your Supabase DB.
\set ON_ERROR_STOP on
begin;

-- Self-contained fixtures: accounts reference auth.users, so create the test auth users first.
-- (In real Supabase these exist via Auth; the postgres role can insert id-only rows for tests.)
insert into auth.users(id) values
  ('aaaaaaaa-0000-0000-0000-0000000000a0'),
  ('bbbbbbbb-0000-0000-0000-0000000000b0') on conflict do nothing;

-- ---- seed ----
insert into app.wedding(id,title) values ('33333333-0000-0000-0000-000000000001','W');

-- owner + proxy accounts (auth_user_id simulates a logged-in Supabase user)
insert into app.account(id,auth_user_id) values
  ('33333333-0000-0000-0000-00000000001a','aaaaaaaa-0000-0000-0000-0000000000a0'),   -- owner
  ('33333333-0000-0000-0000-00000000001b','bbbbbbbb-0000-0000-0000-0000000000b0');   -- proxy
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-00000000001a','active'),
  ('33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-00000000001b','active');
insert into app.operator_role(wedding_id,account_id,role) values
  ('33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-00000000001a','wedding_owner');

insert into app.household(id,wedding_id,name) values
  ('33333333-0000-0000-0000-0000000000a1','33333333-0000-0000-0000-000000000001','H');
insert into app.guest(id,wedding_id,household_id,full_name) values      -- elder, no self account
  ('33333333-0000-0000-0000-0000000000b1','33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-0000000000a1','Ba');
insert into app.guest_delegation(wedding_id,guest_id,account_id,capabilities) values
  ('33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-0000000000b1','33333333-0000-0000-0000-00000000001b','{rsvp,view_schedule}');

insert into app.event_function(id,wedding_id,name,type) values
  ('33333333-0000-0000-0000-0000000000c1','33333333-0000-0000-0000-000000000001','Sangeet','sangeet');
insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival) values
  ('33333333-0000-0000-0000-0000000000d1','33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-0000000000c1','Asia/Kolkata',
   row(now(),now()::timestamp,330,'host')::app.zoned_time);
insert into app.invitation(id,wedding_id,household_id,event_instance_id,status) values
  ('33333333-0000-0000-0000-0000000000e1','33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-0000000000a1','33333333-0000-0000-0000-0000000000d1','sent');
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('33333333-0000-0000-0000-0000000000f1','33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-0000000000e1','33333333-0000-0000-0000-0000000000d1','33333333-0000-0000-0000-0000000000b1');

-- ---- log in AS THE PROXY (auth.uid() -> proxy's auth_user_id) ----
select set_config('request.jwt.claims', json_build_object('sub','bbbbbbbb-0000-0000-0000-0000000000b0')::text, true);

-- STEP 1: propose (must NOT create attendance)
-- channel defaults to 'web'; authority is DERIVED server-side (this login is a delegate for the guest)
select app.propose_rsvp_change('33333333-0000-0000-0000-0000000000f1'::uuid,'accepted'::app.attendance_status) as pid \gset
do $$ begin
  if exists (select 1 from app.event_attendance where invitation_guest_id='33333333-0000-0000-0000-0000000000f1') then
    raise exception 'TEST FAILED: propose created attendance';
  end if;
  raise notice 'OK: propose created a pending proposal, no attendance yet';
end $$;

-- STEP 2: confirm (plain select; :'pid' is substituted safely OUTSIDE any DO block)
select app.confirm_rsvp_change(:'pid'::uuid);

-- attribution + status (DO block queries by the literal invitation_guest_id; no psql vars inside)
do $$
declare v_by uuid; v_status app.attendance_status; v_actor uuid;
        v_chan app.rsvp_channel; v_auth app.rsvp_authority; v_lauth app.rsvp_authority;
begin
  select responded_by_account_id, status, responded_channel, responded_as
    into v_by, v_status, v_chan, v_auth
    from app.event_attendance where invitation_guest_id='33333333-0000-0000-0000-0000000000f1';
  if v_by <> '33333333-0000-0000-0000-00000000001b' then raise exception 'TEST FAILED: attendance not attributed to delegate (got %)', v_by; end if;
  if v_status <> 'accepted' then raise exception 'TEST FAILED: status not accepted'; end if;
  if v_chan <> 'web' then raise exception 'TEST FAILED: channel not web (got %)', v_chan; end if;
  if v_auth <> 'delegate' then raise exception 'TEST FAILED: authority not DERIVED as delegate (got %)', v_auth; end if;
  select l.actor_account_id, l.authority into v_actor, v_lauth
    from app.rsvp_change_log l join app.event_attendance a on a.id = l.event_attendance_id
    where a.invitation_guest_id='33333333-0000-0000-0000-0000000000f1' order by l.at desc limit 1;
  if v_actor <> '33333333-0000-0000-0000-00000000001b' then raise exception 'TEST FAILED: change-log actor not the delegate'; end if;
  if v_lauth <> 'delegate' then raise exception 'TEST FAILED: change-log authority not delegate (got %)', v_lauth; end if;
  raise notice 'OK: attendance + change-log attributed to the delegate; channel=web, authority=delegate (both derived)';
end $$;

-- count consistency
do $$
declare v_acc int;
begin
  select accepted into v_acc from app.instance_rsvp_counts where event_instance_id='33333333-0000-0000-0000-0000000000d1';
  if v_acc <> 1 then raise exception 'TEST FAILED: expected accepted=1, got %', v_acc; end if;
  raise notice 'OK: instance_rsvp_counts.accepted = 1 (derived, consistent)';
end $$;

-- optimistic concurrency: stale expected_version rejected, correct version accepted
select app.propose_rsvp_change('33333333-0000-0000-0000-0000000000f1'::uuid,'declined'::app.attendance_status) as pid2 \gset
create function pg_temp.expect_conflict(p uuid, v int) returns text language plpgsql as $$
begin
  begin
    perform app.confirm_rsvp_change(p, v);
    raise exception 'TEST FAILED: stale expected_version was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    return 'OK: stale expected_version rejected (' || sqlerrm || ')';
  end;
end $$;
select pg_temp.expect_conflict(:'pid2'::uuid, 999);   -- plain select; :'pid2' substituted safely
-- correct version (compute current row_version inline)
select app.confirm_rsvp_change(:'pid2'::uuid,
  (select row_version from app.event_attendance where invitation_guest_id='33333333-0000-0000-0000-0000000000f1'));
do $$ begin
  if (select status from app.event_attendance where invitation_guest_id='33333333-0000-0000-0000-0000000000f1') <> 'declined' then
    raise exception 'TEST FAILED: status not updated to declined';
  end if;
  raise notice 'OK: correct expected_version applied; status now declined';
end $$;

select 'ALL RSVP-FLOW TESTS PASSED' as result;
rollback;
