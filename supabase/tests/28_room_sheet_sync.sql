-- Controlled Sheet staging, preview, commit, idempotency, and authorization.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('28000000-0000-0000-0000-000000000001','sheet-owner@example.test'),('28000000-0000-0000-0000-000000000002','sheet-manager@example.test');
insert into app.account(id,auth_user_id,email) values
 ('28aa0000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000001','sheet-owner@example.test'),
 ('28aa0000-0000-0000-0000-000000000002','28000000-0000-0000-0000-000000000002','sheet-manager@example.test');
insert into app.wedding(id,title) values('28bb0000-0000-0000-0000-000000000001','Sheet wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
 ('28bb0000-0000-0000-0000-000000000001','28aa0000-0000-0000-0000-000000000001','active'),
 ('28bb0000-0000-0000-0000-000000000001','28aa0000-0000-0000-0000-000000000002','active');
insert into app.operator_role(wedding_id,account_id,role) values
 ('28bb0000-0000-0000-0000-000000000001','28aa0000-0000-0000-0000-000000000001','wedding_owner'),
 ('28bb0000-0000-0000-0000-000000000001','28aa0000-0000-0000-0000-000000000002','event_manager');
insert into app.household(id,wedding_id,name) values('28cc0000-0000-0000-0000-000000000001','28bb0000-0000-0000-0000-000000000001','Family');
insert into app.guest(id,wedding_id,household_id,full_name) values
 ('28dd0000-0000-0000-0000-000000000001','28bb0000-0000-0000-0000-000000000001','28cc0000-0000-0000-0000-000000000001','A'),
 ('28dd0000-0000-0000-0000-000000000002','28bb0000-0000-0000-0000-000000000001','28cc0000-0000-0000-0000-000000000001','B');

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','28000000-0000-0000-0000-000000000001')::text,true);
do $$ declare h uuid; r uuid; a uuid; run_id uuid; change_id uuid; result jsonb; begin
 insert into app.hotel(wedding_id,name) values('28bb0000-0000-0000-0000-000000000001','Suryagarh') returning id into h;
 select app.owner_create_room_draft('28bb0000-0000-0000-0000-000000000001',h,'SUR-001',null,2,'double') into r;
 select allocation_id into a from app.owner_save_room_allocation_draft('28bb0000-0000-0000-0000-000000000001',null,r,'28cc0000-0000-0000-0000-000000000001','double',
  array['28dd0000-0000-0000-0000-000000000001'::uuid,'28dd0000-0000-0000-0000-000000000002'::uuid],null,null,null,null,null);
 perform app.owner_configure_room_sheet('28bb0000-0000-0000-0000-000000000001','pilot-sheet-id');
 select app.owner_begin_room_sheet_review('28bb0000-0000-0000-0000-000000000001') into run_id;
 select app.owner_stage_room_sheet_change('28bb0000-0000-0000-0000-000000000001',run_id,'row-1',a,r,1,
  jsonb_build_object('occupancyPlan','double','guestIds',jsonb_build_array('28dd0000-0000-0000-0000-000000000001','28dd0000-0000-0000-0000-000000000002'),
  'checkIn','2026-12-01','checkOut','2026-12-04','status','confirmed','notes','Late arrival','action','update')) into change_id;
 perform app.owner_preview_room_sheet_changes('28bb0000-0000-0000-0000-000000000001',run_id);
 if not exists(select 1 from app.sheet_sync_change where id=change_id and validation_status='accepted') then raise exception 'FAIL(preview)'; end if;
 select app.owner_commit_room_sheet_changes('28bb0000-0000-0000-0000-000000000001',run_id,array[change_id]) into result;
 if result->>'committed' <> '1' then raise exception 'FAIL(commit): %',result; end if;
 if (select status from app.room_allocation where id=a)<>'confirmed' then raise exception 'FAIL(operation)'; end if;
 if (select notes from app.room_allocation where id=a)<>'Late arrival' then raise exception 'FAIL(notes)'; end if;
 if (select primary_household_id from app.room_allocation where id=a)<>'28cc0000-0000-0000-0000-000000000001' then raise exception 'FAIL(primary-household)'; end if;
 if app.owner_commit_room_sheet_changes('28bb0000-0000-0000-0000-000000000001',run_id,array[change_id])<>result then raise exception 'FAIL(idempotent)'; end if;
 begin insert into app.sheet_sync_change(wedding_id,run_id,change_key,allocation_id,room_id,base_revision,proposed) values
  ('28bb0000-0000-0000-0000-000000000001',run_id,'forged',a,r,2,'{}'); raise exception 'FAIL(direct-write)';
 exception when insufficient_privilege then null; end;
end $$;

do $$ declare a uuid; r uuid; run_id uuid; change_id uuid; begin
 select id,room_id into a,r from app.room_allocation where wedding_id='28bb0000-0000-0000-0000-000000000001';
 select app.owner_begin_room_sheet_review('28bb0000-0000-0000-0000-000000000001') into run_id;
 select app.owner_stage_room_sheet_change('28bb0000-0000-0000-0000-000000000001',run_id,'invalid-capacity',a,r,2,
  jsonb_build_object('occupancyPlan','single','guestIds',jsonb_build_array('28dd0000-0000-0000-0000-000000000001','28dd0000-0000-0000-0000-000000000002'),
  'checkIn','2026-12-04','checkOut','2026-12-01','status','confirmed','singleReason','','action','update')) into change_id;
 perform app.owner_preview_room_sheet_changes('28bb0000-0000-0000-0000-000000000001',run_id);
 if not exists(select 1 from app.sheet_sync_change where id=change_id and validation_status='rejected'
   and validation_codes @> array['invalid_date_order','occupancy_count_mismatch','single_reason_required']) then
  raise exception 'FAIL(domain-preview)';
 end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub','28000000-0000-0000-0000-000000000002')::text,true);
do $$ begin
 begin perform app.owner_begin_room_sheet_review('28bb0000-0000-0000-0000-000000000001'); raise exception 'FAIL(manager)';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from app.sheet_sync_run) then raise exception 'FAIL(manager-read)'; end if;
end $$;
reset role;
select 'ALL ROOM SHEET SYNC TESTS PASSED' result;
rollback;
