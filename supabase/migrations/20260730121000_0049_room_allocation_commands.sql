-- Authoritative room-planning command boundary. Authenticated users may read through RLS but every room,
-- allocation, and occupant mutation is serialized and validated inside these owner-only commands.

drop index app.room_one_active_alloc;
create unique index room_one_active_alloc on app.room_allocation(wedding_id, room_id)
  where status in ('held','confirmed','checked_in');

create or replace function app.enforce_room_capacity() returns trigger
language plpgsql security definer set search_path=app,public as $$
declare v_cap int; v_count int; v_status app.stay_status;
begin
  perform 1 from app.guest where wedding_id=new.wedding_id and id=new.guest_id for update;
  select r.capacity,a.status into v_cap,v_status
    from app.room_allocation a join app.room r on r.wedding_id=a.wedding_id and r.id=a.room_id
   where a.wedding_id=new.wedding_id and a.id=new.allocation_id for update of a;
  if v_cap is null then raise exception 'unknown allocation' using errcode='SR404'; end if;
  if v_status not in ('held','confirmed','checked_in') then
    raise exception 'cannot add an occupant to an inactive allocation' using errcode='SA010';
  end if;
  select count(*) into v_count from app.room_occupant o
   where o.wedding_id=new.wedding_id and o.allocation_id=new.allocation_id and o.id<>new.id;
  if v_count+1>v_cap then raise exception 'room is full (capacity %)',v_cap using errcode='SA011'; end if;
  if exists(
    select 1 from app.room_occupant o
    join app.room_allocation a on a.wedding_id=o.wedding_id and a.id=o.allocation_id
    where o.wedding_id=new.wedding_id and o.guest_id=new.guest_id and o.id<>new.id
      and a.status in ('held','confirmed','checked_in')
  ) then raise exception 'guest is already in another active room' using errcode='SA012'; end if;
  return new;
end $$;

create or replace function app.owner_create_room_draft(
  p_wedding uuid, p_hotel uuid, p_provisional text, p_physical text,
  p_capacity int, p_plan app.occupancy_plan
) returns uuid
language plpgsql security definer set search_path=app,public as $$
declare v_room uuid;
begin
  if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='not authorized to manage rooms'; end if;
  if not exists(select 1 from app.hotel where wedding_id=p_wedding and id=p_hotel) then
    raise exception 'unknown property' using errcode='SR404';
  end if;
  if p_capacity not between 1 and 12 then raise exception 'room capacity must be between 1 and 12' using errcode='SR011'; end if;
  insert into app.room(wedding_id,hotel_id,label,provisional_code,physical_room_number,room_type,capacity,inventory_status)
  values(p_wedding,p_hotel,trim(p_provisional),trim(p_provisional),nullif(trim(p_physical),''),p_plan::text::app.room_type,p_capacity,'provisional')
  returning id into v_room;
  return v_room;
end $$;

create or replace function app.owner_update_room_identity(
  p_wedding uuid, p_room uuid, p_provisional text, p_physical text,
  p_capacity int, p_inventory app.room_inventory_status, p_expected_revision bigint
) returns bigint
language plpgsql security definer set search_path=app,public as $$
declare v_revision bigint; v_occupants int; v_new bigint;
begin
  if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='not authorized to manage rooms'; end if;
  select sync_revision into v_revision from app.room where wedding_id=p_wedding and id=p_room for update;
  if not found then raise exception 'unknown room' using errcode='SR404'; end if;
  if v_revision<>p_expected_revision then raise exception 'stale room revision' using errcode='SR409'; end if;
  select count(*) into v_occupants from app.room_occupant o
  join app.room_allocation a on a.wedding_id=o.wedding_id and a.id=o.allocation_id
  where a.wedding_id=p_wedding and a.room_id=p_room and a.status in ('held','confirmed','checked_in');
  if p_capacity<v_occupants then raise exception 'capacity is below active occupant count' using errcode='SR011'; end if;
  v_new:=v_revision+1;
  update app.room set label=trim(p_provisional), provisional_code=trim(p_provisional),
    physical_room_number=nullif(trim(p_physical),''), capacity=p_capacity, inventory_status=p_inventory,
    out_of_service=(p_inventory='out_of_service'), sync_revision=v_new
  where wedding_id=p_wedding and id=p_room;
  update app.room_allocation set sync_revision=sync_revision+1, sharing_confirmed_at=null,
    sharing_confirmed_by=null, sharing_confirmed_revision=null
  where wedding_id=p_wedding and room_id=p_room and status in ('held','confirmed','checked_in');
  return v_new;
end $$;

create or replace function app.owner_save_room_allocation_draft(
  p_wedding uuid, p_allocation uuid, p_room uuid, p_primary_household uuid,
  p_plan app.occupancy_plan, p_guest_ids uuid[], p_check_in date, p_check_out date,
  p_single_reason text, p_expected_revision bigint
) returns table(allocation_id uuid, sync_revision bigint)
language plpgsql security definer set search_path=app,public as $$
declare v_alloc uuid; v_revision bigint; v_capacity int; v_guest_count int; v_distinct_count int;
begin
  if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='not authorized to manage rooms'; end if;
  if p_check_in is not null and p_check_out is not null and p_check_out<p_check_in then
    raise exception 'check-out cannot precede check-in' using errcode='SR012';
  end if;
  select capacity into v_capacity from app.room where wedding_id=p_wedding and id=p_room for update;
  if not found then raise exception 'unknown room' using errcode='SR404'; end if;
  if p_primary_household is not null and not exists(select 1 from app.household where wedding_id=p_wedding and id=p_primary_household) then
    raise exception 'unknown household' using errcode='SR404';
  end if;
  select count(*),count(distinct x) into v_guest_count,v_distinct_count from unnest(coalesce(p_guest_ids,'{}'::uuid[])) x;
  if v_guest_count<>v_distinct_count then raise exception 'duplicate guest selection' using errcode='SR014'; end if;
  if v_guest_count>v_capacity then raise exception 'occupants exceed room capacity' using errcode='SA011'; end if;
  if exists(select 1 from unnest(coalesce(p_guest_ids,'{}'::uuid[])) x
    where not exists(select 1 from app.guest g where g.wedding_id=p_wedding and g.id=x)) then
    raise exception 'unknown guest for this wedding' using errcode='SR404';
  end if;
  perform 1 from app.guest g where g.wedding_id=p_wedding and g.id=any(coalesce(p_guest_ids,'{}'::uuid[])) order by g.id for update;

  if p_allocation is null then
    insert into app.room_allocation(wedding_id,room_id,household_id,primary_household_id,check_in,check_out,status,
      occupancy_plan,single_occupancy_exception_reason,sync_revision)
    values(p_wedding,p_room,p_primary_household,p_primary_household,p_check_in,p_check_out,'held',p_plan,
      nullif(trim(p_single_reason),''),1) returning id into v_alloc;
    v_revision:=1;
  else
    select a.sync_revision into v_revision from app.room_allocation a
      where a.wedding_id=p_wedding and a.id=p_allocation for update;
    if not found then raise exception 'unknown allocation' using errcode='SR404'; end if;
    if v_revision<>p_expected_revision then raise exception 'stale allocation revision' using errcode='SR409'; end if;
    v_alloc:=p_allocation;
    delete from app.room_occupant where wedding_id=p_wedding and allocation_id=v_alloc;
    v_revision:=v_revision+1;
    update app.room_allocation set room_id=p_room, household_id=p_primary_household,
      primary_household_id=p_primary_household, check_in=p_check_in, check_out=p_check_out, status='held',
      occupancy_plan=p_plan, single_occupancy_exception_reason=nullif(trim(p_single_reason),''),
      sharing_confirmed_at=null,sharing_confirmed_by=null,sharing_confirmed_revision=null,sync_revision=v_revision
    where wedding_id=p_wedding and id=v_alloc;
  end if;
  insert into app.room_occupant(wedding_id,allocation_id,guest_id)
    select p_wedding,v_alloc,x from unnest(coalesce(p_guest_ids,'{}'::uuid[])) x order by x;
  allocation_id:=v_alloc; sync_revision:=v_revision; return next;
end $$;

create or replace function app.owner_confirm_room_allocation(
  p_wedding uuid, p_allocation uuid, p_expected_revision bigint
) returns bigint
language plpgsql security definer set search_path=app,public as $$
declare v_plan app.occupancy_plan; v_reason text; v_revision bigint; v_count int; v_capacity int; v_actor uuid; v_household uuid; v_new bigint;
begin
  if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='not authorized to manage rooms'; end if;
  select a.occupancy_plan,a.single_occupancy_exception_reason,a.sync_revision,a.primary_household_id,r.capacity
    into v_plan,v_reason,v_revision,v_household,v_capacity
  from app.room_allocation a join app.room r on r.wedding_id=a.wedding_id and r.id=a.room_id
  where a.wedding_id=p_wedding and a.id=p_allocation for update of a,r;
  if not found then raise exception 'unknown allocation' using errcode='SR404'; end if;
  if v_revision<>p_expected_revision then raise exception 'stale allocation revision' using errcode='SR409'; end if;
  select count(*) into v_count from app.room_occupant where wedding_id=p_wedding and allocation_id=p_allocation;
  if v_count>v_capacity then raise exception 'occupants exceed room capacity' using errcode='SA011'; end if;
  if (v_plan='single' and v_count<>1) or (v_plan='double' and v_count<>2) or (v_plan='triple' and v_count<>3) then
    raise exception 'occupant count does not match occupancy plan' using errcode='SR012';
  end if;
  if v_plan='single' and nullif(trim(v_reason),'') is null then
    raise exception 'single occupancy requires an exception reason' using errcode='SR013';
  end if;
  v_actor:=app.current_account_id(); v_new:=v_revision+1;
  update app.room_allocation set status='confirmed', sharing_confirmed_at=now(), sharing_confirmed_by=v_actor,
    sharing_confirmed_revision=v_new, sync_revision=v_new where wedding_id=p_wedding and id=p_allocation;
  insert into app.stay_activity(wedding_id,actor_account_id,action,summary,household_id)
  values(p_wedding,v_actor,'room_allocated','Confirmed an explicit room sharing plan',v_household);
  return v_new;
end $$;

create or replace function app.owner_cancel_room_allocation(
  p_wedding uuid, p_allocation uuid, p_expected_revision bigint
) returns bigint
language plpgsql security definer set search_path=app,public as $$
declare v_revision bigint; v_household uuid;
begin
  if not app.is_wedding_owner(p_wedding) then raise insufficient_privilege using message='not authorized to manage rooms'; end if;
  select sync_revision,primary_household_id into v_revision,v_household from app.room_allocation
    where wedding_id=p_wedding and id=p_allocation for update;
  if not found then raise exception 'unknown allocation' using errcode='SR404'; end if;
  if v_revision<>p_expected_revision then raise exception 'stale allocation revision' using errcode='SR409'; end if;
  update app.room_allocation set status='cancelled',sync_revision=sync_revision+1,sharing_confirmed_at=null,
    sharing_confirmed_by=null,sharing_confirmed_revision=null where wedding_id=p_wedding and id=p_allocation;
  insert into app.stay_activity(wedding_id,actor_account_id,action,summary,household_id)
  values(p_wedding,app.current_account_id(),'room_released','Cancelled a room allocation',v_household);
  return v_revision+1;
end $$;

revoke insert,update,delete on app.room,app.room_allocation,app.room_occupant from authenticated;
revoke execute on function app.owner_allocate_household(uuid,uuid,uuid,date,date) from authenticated,public,anon;

create or replace function app.can_admin_room_allocation(p_wedding uuid, p_allocation uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select exists(
    select 1 from app.room_occupant o
    where o.wedding_id=p_wedding and o.allocation_id=p_allocation
      and app.can_admin_guest(p_wedding,o.guest_id)
  )
$$;
drop policy alloc_group_admin_read on app.room_allocation;
create policy alloc_group_admin_read on app.room_allocation for select
  using (app.can_admin_room_allocation(wedding_id,id));
revoke execute on function app.can_admin_room_allocation(uuid,uuid) from public,anon;
grant execute on function app.can_admin_room_allocation(uuid,uuid) to authenticated;

revoke execute on function app.owner_create_room_draft(uuid,uuid,text,text,int,app.occupancy_plan) from public,anon;
revoke execute on function app.owner_update_room_identity(uuid,uuid,text,text,int,app.room_inventory_status,bigint) from public,anon;
revoke execute on function app.owner_save_room_allocation_draft(uuid,uuid,uuid,uuid,app.occupancy_plan,uuid[],date,date,text,bigint) from public,anon;
revoke execute on function app.owner_confirm_room_allocation(uuid,uuid,bigint) from public,anon;
revoke execute on function app.owner_cancel_room_allocation(uuid,uuid,bigint) from public,anon;
grant execute on function app.owner_create_room_draft(uuid,uuid,text,text,int,app.occupancy_plan) to authenticated;
grant execute on function app.owner_update_room_identity(uuid,uuid,text,text,int,app.room_inventory_status,bigint) to authenticated;
grant execute on function app.owner_save_room_allocation_draft(uuid,uuid,uuid,uuid,app.occupancy_plan,uuid[],date,date,text,bigint) to authenticated;
grant execute on function app.owner_confirm_room_allocation(uuid,uuid,bigint) to authenticated;
grant execute on function app.owner_cancel_room_allocation(uuid,uuid,bigint) to authenticated;
