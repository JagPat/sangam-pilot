-- 07_owner_setup.sql — adversarial coverage for migration 0010 (self-serve wedding + event setup RPCs).
-- Proves: create_wedding bootstraps the caller as wedding_owner (membership active + operator_role) even
-- though RLS could not have let them insert those rows directly; a signed-out / unknown caller and a blank
-- title are rejected; owner_create_event builds the event_function + a dated event_instance with the CORRECT
-- app.zoned_time offset (IST +330, US-Eastern negative) from a wall clock; owner_update_event renames/moves/
-- cancels; a NON-owner cannot create or edit events; and the internal build_zoned_time is NOT executable by
-- authenticated (revoked from all app roles). Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

-- signed-in identities: UO owns; UN is a different signed-in user who owns nothing here.
insert into auth.users(id,email) values
  ('77aa0000-0000-0000-0000-0000000000a0','owner@e.com'),
  ('77aa0000-0000-0000-0000-0000000000a1','other@e.com');
insert into app.account(id,auth_user_id,email) values
  ('77cc0000-0000-0000-0000-0000000000a0','77aa0000-0000-0000-0000-0000000000a0','owner@e.com'),
  ('77cc0000-0000-0000-0000-0000000000a1','77aa0000-0000-0000-0000-0000000000a1','other@e.com');

-- ===== create_wedding: bootstraps the caller as owner (the chicken-and-egg RLS can't) =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77aa0000-0000-0000-0000-0000000000a0')::text, true); -- UO
do $$ declare v_wed uuid; v_inst uuid; v_off int; v_status app.membership_status; v_tz text; begin
  v_wed := app.create_wedding('Sangam Test Wedding','Aarti & Ben','Asia/Kolkata','2026-12-01','2026-12-03');
  if v_wed is null then raise exception 'FAIL(create_wedding): no wedding id returned'; end if;
  select status into v_status from app.wedding_membership
    where wedding_id=v_wed and account_id='77cc0000-0000-0000-0000-0000000000a0';
  if v_status is distinct from 'active' then raise exception 'FAIL(create_wedding): creator membership not active (%)', v_status; end if;
  if not exists (select 1 from app.operator_role where wedding_id=v_wed and account_id='77cc0000-0000-0000-0000-0000000000a0'
                   and role='wedding_owner' and host_group_id is null) then
    raise exception 'FAIL(create_wedding): creator is not wedding_owner'; end if;
  if not app.is_wedding_owner(v_wed) then raise exception 'FAIL(create_wedding): is_wedding_owner false for the creator'; end if;
  select default_timezone into v_tz from app.wedding where id=v_wed;
  if v_tz <> 'Asia/Kolkata' then raise exception 'FAIL(create_wedding): timezone not stored (%)', v_tz; end if;

  -- owner_create_event: builds function + a dated instance; IST wall clock -> offset +330
  v_inst := app.owner_create_event(v_wed,'Sangeet','sangeet',null, timestamp '2026-12-01 19:00', 'Asia/Kolkata');
  if v_inst is null then raise exception 'FAIL(create_event): no instance id'; end if;
  if not exists (select 1 from app.event_function f
                  join app.event_instance i on i.event_function_id=f.id
                  where i.id=v_inst and f.wedding_id=v_wed and f.name='Sangeet') then
    raise exception 'FAIL(create_event): function/instance not created correctly'; end if;
  select (arrival).offset_minutes into v_off from app.event_instance where id=v_inst;
  if v_off <> 330 then raise exception 'FAIL(create_event): IST offset expected 330, got %', v_off; end if;

  -- a US-Eastern summer wall clock -> negative offset (DST -240), proving the zone math is real
  v_inst := app.owner_create_event(v_wed,'NY Reception','reception',null, timestamp '2026-07-04 18:00', 'America/New_York');
  select (arrival).offset_minutes into v_off from app.event_instance where id=v_inst;
  if v_off <> -240 then raise exception 'FAIL(create_event): US-Eastern (EDT) offset expected -240, got %', v_off; end if;

  -- stash the wedding + an instance for the cross-role checks below (survives the role switch in-txn)
  perform set_config('sangam.wed', v_wed::text, false);
  perform set_config('sangam.inst', v_inst::text, false);
  raise notice 'OK(setup): create_wedding bootstraps owner; owner_create_event builds zoned instances (IST=+330, EDT=-240)';
end $$;

-- ===== owner_update_event: rename + move time + cancel (still as the owner) =====
do $$ declare v_wed uuid := current_setting('sangam.wed')::uuid; v_inst uuid := current_setting('sangam.inst')::uuid;
           v_off int; v_status app.scheduled_status; v_name text; begin
  perform app.owner_update_event(v_wed, v_inst, 'NY Reception (Grand)','reception', null, timestamp '2027-01-10 18:00', 'America/New_York', true);
  select (arrival).offset_minutes, scheduled_status into v_off, v_status from app.event_instance where id=v_inst;
  select name into v_name from app.event_function f join app.event_instance i on i.event_function_id=f.id where i.id=v_inst;
  if v_name <> 'NY Reception (Grand)' then raise exception 'FAIL(update): rename did not persist (%)', v_name; end if;
  if v_status is distinct from 'cancelled' then raise exception 'FAIL(update): cancel flag ignored (%)', v_status; end if;
  if v_off <> -300 then raise exception 'FAIL(update): US-Eastern (EST winter) offset expected -300, got %', v_off; end if;
  raise notice 'OK(update): owner_update_event renames, moves the time (EST=-300), and cancels';
end $$;
reset role;

-- ===== a NON-owner cannot create or edit events in someone else's wedding =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77aa0000-0000-0000-0000-0000000000a1')::text, true); -- UN
do $$ declare v_wed uuid := current_setting('sangam.wed')::uuid; v_inst uuid := current_setting('sangam.inst')::uuid; begin
  begin
    perform app.owner_create_event(v_wed,'Sneaky Event','other',null, timestamp '2026-12-02 12:00','Asia/Kolkata');
    raise exception 'FAIL(authz): a non-owner created an event';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(authz): non-owner blocked from owner_create_event (%)', sqlerrm; end;
  begin
    perform app.owner_update_event(v_wed, v_inst, 'Hijacked',null,null,null,null,false);
    raise exception 'FAIL(authz): a non-owner edited an event';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(authz): non-owner blocked from owner_update_event (%)', sqlerrm; end;
end $$;
reset role;

-- ===== create_wedding rejects a blank title and an unknown (accountless) caller =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','77aa0000-0000-0000-0000-0000000000a0')::text, true); -- UO
do $$ begin
  begin perform app.create_wedding('   ',null,'Asia/Kolkata',null,null);
    raise exception 'FAIL(title): a blank title was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(title): blank wedding title rejected (%)', sqlerrm; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000ff')::text, true); -- no app.account for this sub
do $$ begin
  begin perform app.create_wedding('Ghost Wedding',null,'Asia/Kolkata',null,null);
    raise exception 'FAIL(signin): an accountless caller created a wedding';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(signin): a caller with no app.account is rejected (%)', sqlerrm; end;
end $$;

-- ===== build_zoned_time is INTERNAL: not executable by authenticated (revoked from all app roles) =====
do $$ begin
  begin
    perform app.build_zoned_time(timestamp '2026-12-01 19:00','Asia/Kolkata','host');
    raise exception 'FAIL(internal): authenticated executed build_zoned_time';
  exception when insufficient_privilege then raise notice 'OK(internal): authenticated cannot execute build_zoned_time';
           when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK(internal): build_zoned_time blocked (%)', sqlerrm; end if;
  end;
end $$;
reset role;

select 'ALL OWNER-SETUP TESTS PASSED' as result;
rollback;
