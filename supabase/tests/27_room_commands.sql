-- Atomic room-command and privilege boundary.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('27000000-0000-0000-0000-000000000001','room-owner@example.test'),
  ('27000000-0000-0000-0000-000000000002','room-member@example.test');
insert into app.account(id,auth_user_id,email) values
  ('27aa0000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000001','room-owner@example.test'),
  ('27aa0000-0000-0000-0000-000000000002','27000000-0000-0000-0000-000000000002','room-member@example.test');
insert into app.wedding(id,title) values
  ('27bb0000-0000-0000-0000-000000000001','Room command wedding'),
  ('27bb0000-0000-0000-0000-000000000002','Other room wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('27bb0000-0000-0000-0000-000000000001','27aa0000-0000-0000-0000-000000000001','active'),
  ('27bb0000-0000-0000-0000-000000000001','27aa0000-0000-0000-0000-000000000002','active');
insert into app.operator_role(wedding_id,account_id,role) values
  ('27bb0000-0000-0000-0000-000000000001','27aa0000-0000-0000-0000-000000000001','wedding_owner');
insert into app.household(id,wedding_id,name) values
  ('27cc0000-0000-0000-0000-000000000001','27bb0000-0000-0000-0000-000000000001','One'),
  ('27cc0000-0000-0000-0000-000000000002','27bb0000-0000-0000-0000-000000000001','Two'),
  ('27cc0000-0000-0000-0000-000000000003','27bb0000-0000-0000-0000-000000000002','Other');
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('27dd0000-0000-0000-0000-000000000001','27bb0000-0000-0000-0000-000000000001','27cc0000-0000-0000-0000-000000000001','One A'),
  ('27dd0000-0000-0000-0000-000000000002','27bb0000-0000-0000-0000-000000000001','27cc0000-0000-0000-0000-000000000001','One B'),
  ('27dd0000-0000-0000-0000-000000000003','27bb0000-0000-0000-0000-000000000001','27cc0000-0000-0000-0000-000000000002','Two A'),
  ('27dd0000-0000-0000-0000-000000000004','27bb0000-0000-0000-0000-000000000002','27cc0000-0000-0000-0000-000000000003','Other A');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','27000000-0000-0000-0000-000000000001')::text, true);

do $$
declare v_hotel uuid; v_room uuid; v_single uuid; v_alloc uuid; v_single_alloc uuid; v_request uuid; v_rev bigint; v_audit int;
begin
  insert into app.hotel(wedding_id,name,property_kind,property_status)
  values ('27bb0000-0000-0000-0000-000000000001','Suryagarh','suryagarh','confirmed') returning id into v_hotel;

  select app.owner_create_room_draft('27bb0000-0000-0000-0000-000000000001',v_hotel,'SUR-001',null,2,'double') into v_room;
  select app.owner_create_room_draft('27bb0000-0000-0000-0000-000000000001',v_hotel,'SUR-002',null,1,'single') into v_single;

  select allocation_id, sync_revision into v_alloc, v_rev
  from app.owner_save_room_allocation_draft(
    '27bb0000-0000-0000-0000-000000000001',null,v_room,'27cc0000-0000-0000-0000-000000000001',
    'double',array['27dd0000-0000-0000-0000-000000000001'::uuid,'27dd0000-0000-0000-0000-000000000002'::uuid],
    '2026-12-01','2026-12-04',null,null,null
  );
  if v_rev <> 1 then raise exception 'FAIL(create): initial revision %',v_rev; end if;
  select app.owner_confirm_room_allocation('27bb0000-0000-0000-0000-000000000001',v_alloc,1) into v_rev;
  if v_rev <> 2 then raise exception 'FAIL(confirm): revision %',v_rev; end if;
  if not exists(select 1 from app.room_allocation where id=v_alloc and status='confirmed' and sharing_confirmed_revision=2) then
    raise exception 'FAIL(confirm): confirmation state missing';
  end if;
  select count(*) into v_audit from app.stay_activity where wedding_id='27bb0000-0000-0000-0000-000000000001' and action='room_allocated';
  if v_audit <> 1 then raise exception 'FAIL(audit): expected one transactional confirmation audit, got %',v_audit; end if;

  begin
    perform * from app.owner_save_room_allocation_draft(
      '27bb0000-0000-0000-0000-000000000001',v_alloc,v_room,'27cc0000-0000-0000-0000-000000000001',
      'double',array['27dd0000-0000-0000-0000-000000000001'::uuid,'27dd0000-0000-0000-0000-000000000002'::uuid],
      '2026-12-01','2026-12-04',null,null,1
    );
    raise exception 'FAIL(stale): stale revision was accepted';
  exception when sqlstate 'SR409' then null; end;

  select allocation_id into v_single_alloc
  from app.owner_save_room_allocation_draft(
    '27bb0000-0000-0000-0000-000000000001',null,v_single,'27cc0000-0000-0000-0000-000000000002',
    'single',array['27dd0000-0000-0000-0000-000000000003'::uuid],
    '2026-12-01','2026-12-04',null,null,null
  );
  begin
    perform app.owner_confirm_room_allocation('27bb0000-0000-0000-0000-000000000001',v_single_alloc,1);
    raise exception 'FAIL(single): confirmed without exception reason';
  exception when sqlstate 'SR013' then null; end;

  begin
    perform * from app.owner_save_room_allocation_draft(
      '27bb0000-0000-0000-0000-000000000001',v_single_alloc,v_single,'27cc0000-0000-0000-0000-000000000002',
      'single',array['27dd0000-0000-0000-0000-000000000004'::uuid],
      '2026-12-01','2026-12-04','Privacy requirement',null,1
    );
    raise exception 'FAIL(scope): cross-wedding guest accepted';
  exception when sqlstate 'SR404' then null; end;

  begin
    update app.room set capacity=1 where id=v_room;
    raise exception 'FAIL(privilege): owner bypassed room command with direct DML';
  exception when insufficient_privilege then null; end;

  insert into app.stay_request(wedding_id,household_id,status,party_size)
  values('27bb0000-0000-0000-0000-000000000001','27cc0000-0000-0000-0000-000000000002','needs_room',1)
  returning id into v_request;
  insert into app.stay_request_guest(wedding_id,stay_request_id,guest_id)
  values('27bb0000-0000-0000-0000-000000000001',v_request,'27dd0000-0000-0000-0000-000000000003');
end $$;

do $$ declare n int; begin
  select confirmed_rooms into n from app.room_plan_summary
   where wedding_id='27bb0000-0000-0000-0000-000000000001' and occupancy_plan='double';
  if n<>1 then raise exception 'FAIL(summary): expected one confirmed double, got %',n; end if;
  select draft_rooms into n from app.room_plan_summary
   where wedding_id='27bb0000-0000-0000-0000-000000000001' and occupancy_plan='single';
  if n<>1 then raise exception 'FAIL(summary): expected one draft single, got %',n; end if;
  select count(*) into n from app.unallocated_stay_guest
   where wedding_id='27bb0000-0000-0000-0000-000000000001' and guest_id='27dd0000-0000-0000-0000-000000000003';
  if n<>1 then raise exception 'FAIL(unallocated): explicitly required guest in a draft room must remain unallocated'; end if;
  select count(*) into n from app.room_plan_exception
   where wedding_id='27bb0000-0000-0000-0000-000000000001' and exception_code='single_reason_missing';
  if n<>1 then raise exception 'FAIL(exception): missing single reason not surfaced'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub','27000000-0000-0000-0000-000000000002')::text, true);
do $$ begin
  begin
    perform app.owner_create_room_draft('27bb0000-0000-0000-0000-000000000001',gen_random_uuid(),'X-1',null,2,'double');
    raise exception 'FAIL(authz): member created room';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'ALL ROOM COMMAND TESTS PASSED' as result;
rollback;
