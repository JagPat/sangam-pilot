-- 01_constraints.sql — proves blockers 1,2,5 + cross-wedding isolation at the DB level.
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_constraints.sql
\set ON_ERROR_STOP on
begin;

-- ---- seed (two weddings) ----
insert into app.wedding(id,title) values
  ('11111111-0000-0000-0000-000000000001','W1'),
  ('22222222-0000-0000-0000-000000000002','W2');

insert into app.household(id,wedding_id,name) values
  ('11111111-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-000000000001','H1'),
  ('22222222-0000-0000-0000-0000000000a2','22222222-0000-0000-0000-000000000002','H2');

insert into app.guest(id,wedding_id,household_id,full_name) values
  ('11111111-0000-0000-0000-0000000000b1','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000a1','G1'),
  ('11111111-0000-0000-0000-0000000000b2','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000a1','G2'),
  ('22222222-0000-0000-0000-0000000000b3','22222222-0000-0000-0000-000000000002','22222222-0000-0000-0000-0000000000a2','G3');

insert into app.event_function(id,wedding_id,name,type) values
  ('11111111-0000-0000-0000-0000000000c1','11111111-0000-0000-0000-000000000001','Pithi','pithi'),
  ('22222222-0000-0000-0000-0000000000c2','22222222-0000-0000-0000-000000000002','Pithi','pithi');

-- valid instances (window muhurat that is valid)
insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival,muhurat_kind,muhurat_start,muhurat_end) values
 ('11111111-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000c1','Asia/Kolkata',
   row(timestamptz '2026-12-01 20:00+05:30', timestamp '2026-12-01 20:00', 330, 'host')::app.zoned_time,
   'window',
   row(timestamptz '2026-12-02 00:47+05:30', timestamp '2026-12-02 00:47', 330, 'priest')::app.zoned_time,
   row(timestamptz '2026-12-02 01:30+05:30', timestamp '2026-12-02 01:30', 330, 'priest')::app.zoned_time),
 ('11111111-0000-0000-0000-0000000000d2','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000c1','Asia/Kolkata',
   row(timestamptz '2026-12-01 10:00+05:30', timestamp '2026-12-01 10:00', 330, 'host')::app.zoned_time,
   null,null,null),
 ('22222222-0000-0000-0000-0000000000d3','22222222-0000-0000-0000-000000000002','22222222-0000-0000-0000-0000000000c2','America/New_York',
   row(timestamptz '2026-12-01 18:00-05:00', timestamp '2026-12-01 18:00', -300, 'host')::app.zoned_time,
   null,null,null);
select 'OK: valid window-muhurat + null-muhurat instances inserted' as t;

-- helper: assert the next statement FAILS
create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'OK: % rejected (%)', label, sqlstate; return; end;
  raise exception 'TEST FAILED: % was accepted but should be rejected', label;
end $$;

-- ---- blocker 5: muhurat CHECK ----
select pg_temp.expect_fail($$insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival,muhurat_kind,muhurat_start)
  values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000c1','Asia/Kolkata',
  row(now(),now()::timestamp,330,'host')::app.zoned_time, null, row(now(),now()::timestamp,330,'priest')::app.zoned_time)$$,
  'muhurat_kind NULL with a start set');
select pg_temp.expect_fail($$insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival,muhurat_kind,muhurat_start,muhurat_end)
  values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000c1','Asia/Kolkata',
  row(now(),now()::timestamp,330,'host')::app.zoned_time,'instant',
  row(now(),now()::timestamp,330,'priest')::app.zoned_time, row(now(),now()::timestamp,330,'priest')::app.zoned_time)$$,
  'instant muhurat with an end set');
select pg_temp.expect_fail($$insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival,muhurat_kind,muhurat_start,muhurat_end)
  values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000c1','Asia/Kolkata',
  row(now(),now()::timestamp,330,'host')::app.zoned_time,'window',
  row(timestamptz '2026-01-01 02:00+05:30',timestamp '2026-01-01 02:00',330,'p')::app.zoned_time,
  row(timestamptz '2026-01-01 01:00+05:30',timestamp '2026-01-01 01:00',330,'p')::app.zoned_time)$$,
  'window muhurat with end <= start');

-- ---- invitations ----
insert into app.invitation(id,wedding_id,household_id,event_instance_id,status) values
  ('11111111-0000-0000-0000-0000000000e1','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-0000000000d1','sent');

-- valid invitation_guest (instance matches its invitation)
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('11111111-0000-0000-0000-0000000000f1','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000e1','11111111-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000b1');
select 'OK: valid invitation_guest inserted' as t;

-- ---- blocker 1: instance on invitation_guest must match the invitation's instance ----
select pg_temp.expect_fail($$insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id)
  values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000e1','11111111-0000-0000-0000-0000000000d2','11111111-0000-0000-0000-0000000000b2')$$,
  'invitation_guest pointing at an instance other than its invitation''s');

-- ---- blocker 2: no double-invite of a guest to one instance ----
select pg_temp.expect_fail($$insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id)
  values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000e1','11111111-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000b1')$$,
  'duplicate (instance,guest) invitation_guest');

-- ---- blocker 1 (structural): event_attendance has NO independent guest_id/event_instance_id ----
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='app' and table_name='event_attendance'
               and column_name in ('guest_id','event_instance_id')) then
    raise exception 'TEST FAILED: event_attendance must not carry its own guest_id/event_instance_id';
  end if;
  raise notice 'OK: event_attendance references only invitation_guest (guest/instance derived)';
end $$;

-- ---- cross-wedding isolation: W1 invitation cannot reference a W2 instance ----
select pg_temp.expect_fail($$insert into app.invitation(id,wedding_id,household_id,event_instance_id,status)
  values (gen_random_uuid(),'11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-0000000000a1','22222222-0000-0000-0000-0000000000d3','sent')$$,
  'W1 invitation referencing a W2 event_instance');

select 'ALL CONSTRAINT TESTS PASSED' as result;
rollback;
