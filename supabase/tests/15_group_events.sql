-- 15_group_events.sql — coverage for migration 0021 (family-admin scoped events).
-- Proves a bride-side admin can create an event hosted by THEIR side and edit/cancel it, but cannot create an
-- event for the groom side, cannot edit a groom-hosted event, and a non-admin member cannot create at all;
-- the owner can still edit anything. Requires 00_roles + auth stub + migrations/grants (through 0021).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('fd110000-0000-0000-0000-0000000000a0','ov@ev.com'),
  ('fd110000-0000-0000-0000-0000000000b1','bride@ev.com'),
  ('fd110000-0000-0000-0000-0000000000c1','groom@ev.com'),
  ('fd110000-0000-0000-0000-0000000000e1','plain@ev.com');
insert into app.account(id,auth_user_id,email) values
  ('fdcc0000-0000-0000-0000-0000000000a0','fd110000-0000-0000-0000-0000000000a0','ov@ev.com'),
  ('fdcc0000-0000-0000-0000-0000000000b1','fd110000-0000-0000-0000-0000000000b1','bride@ev.com'),
  ('fdcc0000-0000-0000-0000-0000000000c1','fd110000-0000-0000-0000-0000000000c1','groom@ev.com'),
  ('fdcc0000-0000-0000-0000-0000000000e1','fd110000-0000-0000-0000-0000000000e1','plain@ev.com');
insert into app.wedding(id,title) values ('fd000000-0000-0000-0000-000000000001','EV Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000a0','active'),
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000b1','active'),
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000c1','active'),
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000e1','active');
insert into app.host_group(id,wedding_id,kind,name) values
  ('fd000000-0000-0000-0000-0000000000bf','fd000000-0000-0000-0000-000000000001','bride_family','Bride family'),
  ('fd000000-0000-0000-0000-0000000000cf','fd000000-0000-0000-0000-000000000001','groom_family','Groom family');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000a0','wedding_owner',null),
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000b1','host_group_admin','fd000000-0000-0000-0000-0000000000bf'),
  ('fd000000-0000-0000-0000-000000000001','fdcc0000-0000-0000-0000-0000000000c1','host_group_admin','fd000000-0000-0000-0000-0000000000cf');
insert into app.venue(id,wedding_id,name,iana_timezone) values
  ('fd000000-0000-0000-0000-0000000000e9','fd000000-0000-0000-0000-000000000001','Lawn','Asia/Kolkata');

set local role authenticated;

-- ===== owner seeds a GROOM-hosted event (for the cross-side edit test) =====
select set_config('request.jwt.claims', json_build_object('sub','fd110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare v uuid; begin
  v := app.owner_create_event(
    p_wedding => 'fd000000-0000-0000-0000-000000000001', p_name => 'Baraat', p_type => 'baraat',
    p_venue => null, p_wall => timestamp '2026-08-14 17:00', p_tz => 'Asia/Kolkata',
    p_host_groups => array['fd000000-0000-0000-0000-0000000000cf']::uuid[]);
  perform set_config('ev.groom', v::text, false);
  raise notice 'OK(setup): owner created a groom-hosted Baraat';
end $$;

-- ===== bride admin: create own-side event, refuse groom side =====
select set_config('request.jwt.claims', json_build_object('sub','fd110000-0000-0000-0000-0000000000b1')::text, true);
do $$ declare v uuid; n int; begin
  v := app.group_create_event('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-0000000000bf',
        'Mehndi','mehndi','fd000000-0000-0000-0000-0000000000e9', timestamp '2026-08-13 18:00','Asia/Kolkata');
  perform set_config('ev.bride', v::text, false);
  select count(*) into n from app.event_instance where id = v; if n<>1 then raise exception 'FAIL(create): bride event not created'; end if;
  select count(*) into n from app.event_host_group where event_instance_id = v and host_group_id='fd000000-0000-0000-0000-0000000000bf';
  if n<>1 then raise exception 'FAIL(create): bride event not hosted by the bride side'; end if;
  select count(*) into n from app.event_host_group where event_instance_id = v and host_group_id='fd000000-0000-0000-0000-0000000000cf';
  if n<>0 then raise exception 'FAIL(create): bride event leaked onto the groom side'; end if;
  raise notice 'OK(bride-create): created a bride-hosted Mehndi, hosted by their side only';

  begin
    perform app.group_create_event('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-0000000000cf',
      'Sneak','other',null, timestamp '2026-08-13 20:00','Asia/Kolkata');
    raise exception 'FAIL(cross-create): bride admin created a GROOM-side event';
  exception when others then
    if sqlerrm <> 'not authorized to manage this side' then raise; end if;
  end;
  raise notice 'OK(bride-create): refused creating a groom-side event';
end $$;

-- ===== bride admin: edit + cancel own event; cannot edit groom event =====
do $$ declare v_bride uuid := current_setting('ev.bride'); v_groom uuid := current_setting('ev.groom'); nm text; st text; begin
  perform app.group_update_event('fd000000-0000-0000-0000-000000000001', v_bride, 'Mehndi Night','mehndi',null,null,null,false);
  select f.name into nm from app.event_function f join app.event_instance i on i.event_function_id=f.id where i.id=v_bride;
  if nm <> 'Mehndi Night' then raise exception 'FAIL(edit): bride rename did not take (got %)', nm; end if;

  perform app.group_update_event('fd000000-0000-0000-0000-000000000001', v_bride, null,null,null,null,null,true);
  select scheduled_status::text into st from app.event_instance where id=v_bride;
  if st <> 'cancelled' then raise exception 'FAIL(cancel): bride event not cancelled (got %)', st; end if;
  raise notice 'OK(bride-edit): renamed + cancelled their own event';

  begin
    perform app.group_update_event('fd000000-0000-0000-0000-000000000001', v_groom, 'Hacked','other',null,null,null,false);
    raise exception 'FAIL(cross-edit): bride admin edited a GROOM event';
  exception when others then
    if sqlerrm <> 'not authorized to manage this event' then raise; end if;
  end;
  select f.name into nm from app.event_function f join app.event_instance i on i.event_function_id=f.id where i.id=v_groom;
  if nm <> 'Baraat' then raise exception 'FAIL(cross-edit): groom event name changed to %', nm; end if;
  raise notice 'OK(bride-edit): refused editing the groom event; it is unchanged';
end $$;

-- ===== plain member (no operator role) cannot create =====
select set_config('request.jwt.claims', json_build_object('sub','fd110000-0000-0000-0000-0000000000e1')::text, true);
do $$ begin
  begin
    perform app.group_create_event('fd000000-0000-0000-0000-000000000001','fd000000-0000-0000-0000-0000000000bf',
      'Nope','other',null, timestamp '2026-08-13 12:00','Asia/Kolkata');
    raise exception 'FAIL(member): a plain member created an event';
  exception when others then
    if sqlerrm <> 'not authorized to manage this side' then raise; end if;
  end;
  raise notice 'OK(member): a plain member cannot create events';
end $$;

-- ===== owner can still edit the bride event =====
select set_config('request.jwt.claims', json_build_object('sub','fd110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare v_bride uuid := current_setting('ev.bride'); st text; begin
  perform app.owner_update_event('fd000000-0000-0000-0000-000000000001', v_bride, null,null,null,null,null,false);
  select scheduled_status::text into st from app.event_instance where id=v_bride;
  if st <> 'scheduled' then raise exception 'FAIL(owner): owner could not restore the bride event'; end if;
  raise notice 'OK(owner): owner restored the bride event (owner overrides side scoping)';
end $$;

reset role;
rollback;
