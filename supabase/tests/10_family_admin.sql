-- 10_family_admin.sql — adversarial coverage for migration 0016 (family-admin scoped guest management).
-- Proves a bride-side host_group_admin: can read + manage their OWN side's household/guest/contact/
-- invitation/dietary; can read the shared event schedule; but CANNOT read, insert, update, or delete any
-- groom-side (or unassigned) household/guest, cannot invite a groom-side household, and cannot write events.
-- And the owner still sees both sides. Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

-- ===================== fixtures (as superuser; RLS not yet in force for these inserts) =====================
insert into auth.users(id,email) values
  ('fa110000-0000-0000-0000-0000000000a0','owner@fa.com'),
  ('fa110000-0000-0000-0000-0000000000b1','bride.admin@fa.com'),
  ('fa110000-0000-0000-0000-0000000000c1','plain.member@fa.com');
insert into app.account(id,auth_user_id,email) values
  ('facc0000-0000-0000-0000-0000000000a0','fa110000-0000-0000-0000-0000000000a0','owner@fa.com'),
  ('facc0000-0000-0000-0000-0000000000b1','fa110000-0000-0000-0000-0000000000b1','bride.admin@fa.com'),
  ('facc0000-0000-0000-0000-0000000000c1','fa110000-0000-0000-0000-0000000000c1','plain.member@fa.com');

insert into app.wedding(id,title) values ('fa000000-0000-0000-0000-000000000001','FA Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('fa000000-0000-0000-0000-000000000001','facc0000-0000-0000-0000-0000000000a0','active'),
  ('fa000000-0000-0000-0000-000000000001','facc0000-0000-0000-0000-0000000000b1','active'),
  ('fa000000-0000-0000-0000-000000000001','facc0000-0000-0000-0000-0000000000c1','active');

insert into app.host_group(id,wedding_id,kind,name) values
  ('fa000000-0000-0000-0000-0000000000bf','fa000000-0000-0000-0000-000000000001','bride_family','Bride family'),
  ('fa000000-0000-0000-0000-0000000000cf','fa000000-0000-0000-0000-000000000001','groom_family','Groom family');

insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('fa000000-0000-0000-0000-000000000001','facc0000-0000-0000-0000-0000000000a0','wedding_owner',null),
  ('fa000000-0000-0000-0000-000000000001','facc0000-0000-0000-0000-0000000000b1','host_group_admin','fa000000-0000-0000-0000-0000000000bf');

-- one household per side + one unassigned; a guest in each of the two sides
insert into app.household(id,wedding_id,name,host_group_id) values
  ('fa000000-0000-0000-0000-0000000000b8','fa000000-0000-0000-0000-000000000001','Bride HH','fa000000-0000-0000-0000-0000000000bf'),
  ('fa000000-0000-0000-0000-0000000000c8','fa000000-0000-0000-0000-000000000001','Groom HH','fa000000-0000-0000-0000-0000000000cf'),
  ('fa000000-0000-0000-0000-0000000000d8','fa000000-0000-0000-0000-000000000001','Unassigned HH',null);
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('fa000000-0000-0000-0000-0000000000b9','fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000b8','Bride Guest'),
  ('fa000000-0000-0000-0000-0000000000c9','fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000c8','Groom Guest');

-- owner creates a real event (via the RPC, which builds the zoned_time), hosted by the groom side
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','fa110000-0000-0000-0000-0000000000a0')::text, true); -- owner
do $$ declare v_ei uuid; begin
  v_ei := app.owner_create_event('fa000000-0000-0000-0000-000000000001','Sangeet','sangeet',null,
                                 '2026-08-14 19:00','Asia/Kolkata',null,null,null,null,null,
                                 array['fa000000-0000-0000-0000-0000000000cf']::uuid[]);
  perform set_config('fa.ei', v_ei::text, false);
end $$;

-- ============================ as the BRIDE-SIDE admin ============================
select set_config('request.jwt.claims', json_build_object('sub','fa110000-0000-0000-0000-0000000000b1')::text, true);

-- ---- reads: own side visible, other side + unassigned invisible ----
do $$ declare n int; begin
  select count(*) into n from app.household where id = 'fa000000-0000-0000-0000-0000000000b8'; if n<>1 then raise exception 'FAIL(read): bride admin cannot see own-side household'; end if;
  select count(*) into n from app.guest     where id = 'fa000000-0000-0000-0000-0000000000b9'; if n<>1 then raise exception 'FAIL(read): bride admin cannot see own-side guest'; end if;
  select count(*) into n from app.household where id = 'fa000000-0000-0000-0000-0000000000c8'; if n<>0 then raise exception 'FAIL(leak): bride admin can SEE groom-side household'; end if;
  select count(*) into n from app.guest     where id = 'fa000000-0000-0000-0000-0000000000c9'; if n<>0 then raise exception 'FAIL(leak): bride admin can SEE groom-side guest'; end if;
  select count(*) into n from app.household where id = 'fa000000-0000-0000-0000-0000000000d8'; if n<>0 then raise exception 'FAIL(leak): bride admin can SEE an unassigned household'; end if;
  select count(*) into n from app.guest;                                                       if n<>1 then raise exception 'FAIL(leak): bride admin sees % guests, expected only their 1', n; end if;
  raise notice 'OK(read): bride admin sees only their own side (1 household, 1 guest); groom + unassigned hidden';
end $$;

-- ---- writes on own side: allowed ----
do $$ begin
  insert into app.guest(wedding_id,household_id,full_name)
    values ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000b8','New Bride Guest');
  update app.guest set full_name='Bride Guest (edited)' where id='fa000000-0000-0000-0000-0000000000b9';
  insert into app.guest_dietary_profile(wedding_id,guest_id,category)
    values ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000b9','veg'::app.dietary_category);
  raise notice 'OK(write-own): bride admin added + edited an own-side guest and set dietary';
end $$;

-- ---- invite own-side guest to the (groom-hosted) event: allowed. invite via a groom household: denied ----
do $$ declare v_ei uuid := current_setting('fa.ei'); v_inv uuid; begin
  insert into app.invitation(wedding_id,household_id,event_instance_id,status)
    values ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000b8',v_ei,'sent') returning id into v_inv;
  insert into app.invitation_guest(wedding_id,invitation_id,event_instance_id,guest_id)
    values ('fa000000-0000-0000-0000-000000000001',v_inv,v_ei,'fa000000-0000-0000-0000-0000000000b9');
  raise notice 'OK(invite-own): bride admin invited their own guest to the event';
  begin
    insert into app.invitation(wedding_id,household_id,event_instance_id,status)
      values ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000c8',v_ei,'sent');
    raise exception 'FAIL(invite-cross): bride admin created an invitation for a GROOM household';
  exception when insufficient_privilege then null; end;
  raise notice 'OK(invite-cross): bride admin refused an invitation for a groom household';
end $$;

-- ---- writes on the other side: all denied ----
do $$ declare n int; begin
  -- INSERT into a groom household -> RLS WITH CHECK denial (error)
  begin
    insert into app.guest(wedding_id,household_id,full_name)
      values ('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-0000000000c8','Sneaky');
    raise exception 'FAIL(write-cross): bride admin INSERTED a guest into a groom household';
  exception when insufficient_privilege then null; end;
  -- UPDATE a groom guest -> matches 0 rows (invisible), name must be unchanged
  update app.guest set full_name='hacked' where id='fa000000-0000-0000-0000-0000000000c9';
  get diagnostics n = row_count; if n<>0 then raise exception 'FAIL(write-cross): bride admin UPDATED a groom guest (% rows)', n; end if;
  -- DELETE a groom household -> 0 rows
  delete from app.household where id='fa000000-0000-0000-0000-0000000000c8';
  get diagnostics n = row_count; if n<>0 then raise exception 'FAIL(write-cross): bride admin DELETED a groom household (% rows)', n; end if;
  -- try to STEAL a groom household onto the bride side -> 0 rows (USING hides it)
  update app.household set host_group_id='fa000000-0000-0000-0000-0000000000bf' where id='fa000000-0000-0000-0000-0000000000c8';
  get diagnostics n = row_count; if n<>0 then raise exception 'FAIL(steal): bride admin reassigned a groom household to their side'; end if;
  raise notice 'OK(write-cross): every groom-side insert/update/delete/steal denied';
end $$;

-- ---- events: readable, but not writable by a family admin ----
do $$ declare n int; begin
  select count(*) into n from app.event_instance where wedding_id='fa000000-0000-0000-0000-000000000001';
  if n<1 then raise exception 'FAIL(event-read): bride admin cannot read the schedule'; end if;
  begin
    insert into app.event_function(wedding_id,name,type) values ('fa000000-0000-0000-0000-000000000001','Sneak','other');
    raise exception 'FAIL(event-write): bride admin created an event_function';
  exception when insufficient_privilege then null; end;
  raise notice 'OK(events): bride admin can READ the schedule but cannot write events';
end $$;

-- ============================ a plain member (no operator role) sees nothing ============================
select set_config('request.jwt.claims', json_build_object('sub','fa110000-0000-0000-0000-0000000000c1')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.household; if n<>0 then raise exception 'FAIL(member): a plain member sees % households', n; end if;
  select count(*) into n from app.guest;     if n<>0 then raise exception 'FAIL(member): a plain member sees % guests', n; end if;
  raise notice 'OK(member): a plain member (no operator role) sees no households or guests';
end $$;

-- ============================ the owner still sees BOTH sides ============================
select set_config('request.jwt.claims', json_build_object('sub','fa110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.household where wedding_id='fa000000-0000-0000-0000-000000000001';
  if n<>3 then raise exception 'FAIL(owner): owner sees % households, expected 3', n; end if;
  select count(*) into n from app.guest where wedding_id='fa000000-0000-0000-0000-000000000001';
  if n<>3 then raise exception 'FAIL(owner): owner sees % guests, expected 3 (2 seed + 1 the admin added)', n; end if;
  raise notice 'OK(owner): owner still sees both sides (3 households, 3 guests)';
end $$;

reset role;
rollback;
