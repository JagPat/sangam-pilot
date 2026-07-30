-- Owner-controlled Google Sheet synchronization. Sheet rows are staged proposals; only an owner commit
-- reaches the authoritative room commands. No Google credentials or contact data are stored here.
create type app.sheet_sync_run_status as enum('detected','validated','committing','committed','rejected','superseded','failed');
create type app.sheet_change_status as enum('pending','accepted','rejected','committed');

create table app.sheet_sync_connection(
 id uuid primary key default gen_random_uuid(), wedding_id uuid not null references app.wedding(id) on delete cascade,
 spreadsheet_id text not null, enabled boolean not null default true, created_by uuid not null references app.account(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(wedding_id)
);
create table app.sheet_sync_run(
 id uuid primary key default gen_random_uuid(), wedding_id uuid not null references app.wedding(id) on delete cascade,
 direction text not null default 'import' check(direction in('import','export')), status app.sheet_sync_run_status not null default 'detected',
 actor_account_id uuid not null references app.account(id), result jsonb, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(wedding_id,id)
);
create unique index sheet_one_committing_run on app.sheet_sync_run(wedding_id) where status='committing';
create table app.sheet_sync_change(
 id uuid primary key default gen_random_uuid(), wedding_id uuid not null references app.wedding(id) on delete cascade,
 run_id uuid not null, change_key text not null, allocation_id uuid, room_id uuid, base_revision bigint not null,
 proposed jsonb not null, validation_status app.sheet_change_status not null default 'pending', validation_codes text[] not null default '{}',
 committed_revision bigint, created_at timestamptz not null default now(),
 unique(run_id,change_key), unique(run_id,allocation_id),
 foreign key(wedding_id,run_id) references app.sheet_sync_run(wedding_id,id) on delete cascade,
 foreign key(wedding_id,allocation_id) references app.room_allocation(wedding_id,id) on delete cascade,
 foreign key(wedding_id,room_id) references app.room(wedding_id,id) on delete cascade
);
alter table app.sheet_sync_connection enable row level security;
alter table app.sheet_sync_run enable row level security;
alter table app.sheet_sync_change enable row level security;
create policy sheet_connection_owner_read on app.sheet_sync_connection for select using(app.is_wedding_owner(wedding_id));
create policy sheet_run_owner_read on app.sheet_sync_run for select using(app.is_wedding_owner(wedding_id));
create policy sheet_change_owner_read on app.sheet_sync_change for select using(app.is_wedding_owner(wedding_id));
grant select on app.sheet_sync_connection,app.sheet_sync_run,app.sheet_sync_change to authenticated;
revoke insert,update,delete on app.sheet_sync_connection,app.sheet_sync_run,app.sheet_sync_change from authenticated;

create function app.owner_configure_room_sheet(p_wedding uuid,p_spreadsheet_id text) returns uuid
language plpgsql security definer set search_path=app,public as $$ declare v_id uuid; begin
 if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='only the wedding owner can configure Sheet sync'; end if;
 if nullif(trim(p_spreadsheet_id),'') is null then raise exception 'spreadsheet ID is required'; end if;
 insert into app.sheet_sync_connection(wedding_id,spreadsheet_id,created_by) values(p_wedding,trim(p_spreadsheet_id),app.current_account_id())
 on conflict(wedding_id) do update set spreadsheet_id=excluded.spreadsheet_id,enabled=true,updated_at=now()
 returning id into v_id; return v_id;
end $$;

create function app.owner_begin_room_sheet_review(p_wedding uuid) returns uuid
language plpgsql security definer set search_path=app,public as $$ declare v_id uuid; begin
 if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='only the wedding owner can review Sheet changes'; end if;
 if not exists(select 1 from app.sheet_sync_connection where wedding_id=p_wedding and enabled) then raise exception 'Sheet sync is not configured'; end if;
 insert into app.sheet_sync_run(wedding_id,actor_account_id) values(p_wedding,app.current_account_id()) returning id into v_id; return v_id;
end $$;

create function app.owner_stage_room_sheet_change(p_wedding uuid,p_run uuid,p_change_key text,p_allocation uuid,p_room uuid,p_base_revision bigint,p_proposed jsonb) returns uuid
language plpgsql security definer set search_path=app,public as $$ declare v_id uuid; begin
 if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='only the wedding owner can stage Sheet changes'; end if;
 if not exists(select 1 from app.sheet_sync_run where wedding_id=p_wedding and id=p_run and status='detected') then raise exception 'review run is not open'; end if;
 insert into app.sheet_sync_change(wedding_id,run_id,change_key,allocation_id,room_id,base_revision,proposed)
 values(p_wedding,p_run,p_change_key,p_allocation,p_room,p_base_revision,p_proposed) returning id into v_id; return v_id;
end $$;

create function app.owner_preview_room_sheet_changes(p_wedding uuid,p_run uuid) returns void
language plpgsql security definer set search_path=app,public as $$ begin
 if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='only the wedding owner can preview Sheet changes'; end if;
 perform 1 from app.sheet_sync_run where wedding_id=p_wedding and id=p_run and status='detected' for update;
 if not found then raise exception 'review run is not open'; end if;
 update app.sheet_sync_change c set
  validation_status=case when a.sync_revision=c.base_revision and a.room_id=c.room_id then 'accepted'::app.sheet_change_status else 'rejected'::app.sheet_change_status end,
  validation_codes=case when a.sync_revision<>c.base_revision then array['stale_revision']::text[]
                        when a.room_id<>c.room_id then array['room_mismatch']::text[] else '{}'::text[] end
 from app.room_allocation a where c.wedding_id=p_wedding and c.run_id=p_run and a.wedding_id=c.wedding_id and a.id=c.allocation_id;
 update app.sheet_sync_change set validation_status='rejected',validation_codes=array['unknown_or_deleted_id']
  where wedding_id=p_wedding and run_id=p_run and validation_status='pending';
 update app.sheet_sync_run set status='validated' where wedding_id=p_wedding and id=p_run;
end $$;

create function app.owner_commit_room_sheet_changes(p_wedding uuid,p_run uuid,p_change_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=app,public as $$
declare v_status app.sheet_sync_run_status; v_result jsonb; v_count int; v_revision bigint; c record; v_guests uuid[]; v_saved record;
begin
 if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='only the wedding owner can commit Sheet changes'; end if;
 select status,result into v_status,v_result from app.sheet_sync_run where wedding_id=p_wedding and id=p_run for update;
 if not found then raise exception 'unknown Sheet review run'; end if;
 if v_status='committed' then return v_result; end if;
 if v_status<>'validated' then raise exception 'Sheet review must be validated before commit'; end if;
 select count(*) into v_count from app.sheet_sync_change where wedding_id=p_wedding and run_id=p_run and id=any(p_change_ids) and validation_status='accepted';
 if v_count<>cardinality(p_change_ids) then raise exception 'one or more selected Sheet changes are invalid or stale' using errcode='SR409'; end if;
 update app.sheet_sync_run set status='committing' where wedding_id=p_wedding and id=p_run;
 for c in select * from app.sheet_sync_change where wedding_id=p_wedding and run_id=p_run and id=any(p_change_ids) order by id for update loop
  if c.proposed->>'action'='cancel' then
   v_revision:=app.owner_cancel_room_allocation(p_wedding,c.allocation_id,c.base_revision);
  else
   select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_guests from jsonb_array_elements_text(coalesce(c.proposed->'guestIds','[]'));
   select * into v_saved from app.owner_save_room_allocation_draft(p_wedding,c.allocation_id,c.room_id,null,
    coalesce(c.proposed->>'occupancyPlan','double')::app.occupancy_plan,v_guests,nullif(c.proposed->>'checkIn','')::date,
    nullif(c.proposed->>'checkOut','')::date,nullif(c.proposed->>'singleReason',''),c.base_revision);
   v_revision:=v_saved.sync_revision;
   if c.proposed->>'status'='confirmed' then v_revision:=app.owner_confirm_room_allocation(p_wedding,c.allocation_id,v_revision); end if;
  end if;
  update app.sheet_sync_change set validation_status='committed',committed_revision=v_revision where id=c.id;
 end loop;
 v_result:=jsonb_build_object('committed',v_count,'runId',p_run);
 update app.sheet_sync_run set status='committed',result=v_result,completed_at=now() where wedding_id=p_wedding and id=p_run;
 return v_result;
exception when others then
 if sqlstate not in('42501','SR409') then update app.sheet_sync_run set status='failed',result=jsonb_build_object('error','commit_failed'),completed_at=now() where wedding_id=p_wedding and id=p_run; end if;
 raise;
end $$;

revoke execute on function app.owner_configure_room_sheet(uuid,text),app.owner_begin_room_sheet_review(uuid),
 app.owner_stage_room_sheet_change(uuid,uuid,text,uuid,uuid,bigint,jsonb),app.owner_preview_room_sheet_changes(uuid,uuid),
 app.owner_commit_room_sheet_changes(uuid,uuid,uuid[]) from public,anon;
grant execute on function app.owner_configure_room_sheet(uuid,text),app.owner_begin_room_sheet_review(uuid),
 app.owner_stage_room_sheet_change(uuid,uuid,text,uuid,uuid,bigint,jsonb),app.owner_preview_room_sheet_changes(uuid,uuid),
 app.owner_commit_room_sheet_changes(uuid,uuid,uuid[]) to authenticated;
