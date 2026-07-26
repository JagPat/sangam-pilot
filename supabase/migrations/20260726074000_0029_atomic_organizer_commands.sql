-- Serialize capacity and double-booking checks for concurrent room updates.
create or replace function app.enforce_room_capacity() returns trigger
language plpgsql security definer set search_path=app,public as $$
declare v_cap int; v_count int; v_status app.stay_status;
begin
  perform 1 from app.guest where wedding_id=new.wedding_id and id=new.guest_id for update;
  select r.capacity,a.status into v_cap,v_status
    from app.room_allocation a join app.room r on r.wedding_id=a.wedding_id and r.id=a.room_id
   where a.wedding_id=new.wedding_id and a.id=new.allocation_id for update of a;
  if v_cap is null then raise exception 'unknown allocation'; end if;
  if v_status='cancelled' then raise exception 'cannot add a roommate to a cancelled allocation' using errcode='SA010'; end if;
  select count(*) into v_count from app.room_occupant o where o.wedding_id=new.wedding_id and o.allocation_id=new.allocation_id and o.id<>new.id;
  if v_count+1>v_cap then raise exception 'room is full (capacity %)',v_cap using errcode='SA011'; end if;
  if exists(select 1 from app.room_occupant o join app.room_allocation a on a.wedding_id=o.wedding_id and a.id=o.allocation_id
    where o.wedding_id=new.wedding_id and o.guest_id=new.guest_id and o.id<>new.id and a.status<>'cancelled')
  then raise exception 'guest is already a roommate in another active room' using errcode='SA012'; end if;
  return new;
end $$;

create or replace function app.organizer_add_guest(p_wedding uuid,p_household uuid,p_new_household text,p_host_group uuid,p_name text,p_email text)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_household uuid; v_group uuid; v_guest uuid; v_email text;
begin
  if nullif(trim(p_name),'') is null then raise exception 'guest name is required'; end if;
  if p_household is not null then
    if not (app.is_wedding_owner(p_wedding) or app.can_admin_household(p_wedding,p_household)) then raise exception 'not authorized to manage this household'; end if;
    v_household:=p_household;
  else
    if nullif(trim(p_new_household),'') is null then raise exception 'household is required'; end if;
    if app.is_wedding_owner(p_wedding) then v_group:=p_host_group;
    else
      select host_group_id into v_group from app.operator_role where wedding_id=p_wedding and account_id=app.current_account_id() and role='host_group_admin' limit 1;
      if v_group is null then raise exception 'not authorized to create a household'; end if;
    end if;
    insert into app.household(wedding_id,name,host_group_id) values(p_wedding,trim(p_new_household),v_group) returning id into v_household;
  end if;
  insert into app.guest(wedding_id,household_id,full_name,show_in_directory) values(p_wedding,v_household,trim(p_name),false) returning id into v_guest;
  v_email:=nullif(lower(trim(coalesce(p_email,''))), '');
  if v_email is not null then insert into app.household_contact(wedding_id,household_id,guest_id,channel,value,is_shared) values(p_wedding,v_household,v_guest,'email',v_email,false); end if;
  return v_guest;
end $$;

create or replace function app.organizer_invite_guest(p_wedding uuid,p_guest uuid,p_household uuid,p_instance uuid)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_invitation uuid;
begin
  if not exists(select 1 from app.guest where wedding_id=p_wedding and id=p_guest and household_id=p_household) then raise exception 'guest not found in household'; end if;
  if not (app.is_wedding_owner(p_wedding) or app.can_admin_guest(p_wedding,p_guest)) then raise exception 'not authorized to invite this guest'; end if;
  if not exists(select 1 from app.event_instance where wedding_id=p_wedding and id=p_instance) then raise exception 'event instance not found'; end if;
  perform 1 from app.household where wedding_id=p_wedding and id=p_household for update;
  select id into v_invitation from app.invitation
   where wedding_id=p_wedding and household_id=p_household and event_instance_id=p_instance
   order by created_at limit 1 for update;
  if v_invitation is null then
    insert into app.invitation(wedding_id,household_id,event_instance_id,status)
    values(p_wedding,p_household,p_instance,'sent') returning id into v_invitation;
  else
    update app.invitation set status='sent' where id=v_invitation;
  end if;
  insert into app.invitation_guest(wedding_id,invitation_id,event_instance_id,guest_id) values(p_wedding,v_invitation,p_instance,p_guest)
  on conflict(wedding_id,event_instance_id,guest_id) do nothing;
  return v_invitation;
end $$;

create or replace function app.owner_allocate_household(p_wedding uuid,p_room uuid,p_household uuid,p_check_in date,p_check_out date)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_alloc uuid; v_capacity int;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to allocate rooms'; end if;
  select capacity into strict v_capacity from app.room where wedding_id=p_wedding and id=p_room for update;
  perform 1 from app.household where wedding_id=p_wedding and id=p_household for update;
  insert into app.room_allocation(wedding_id,room_id,household_id,check_in,check_out,status) values(p_wedding,p_room,p_household,p_check_in,p_check_out,'held') returning id into v_alloc;
  insert into app.room_occupant(wedding_id,allocation_id,guest_id)
    select p_wedding,v_alloc,g.id from app.guest g where g.wedding_id=p_wedding and g.household_id=p_household order by g.id limit v_capacity;
  return v_alloc;
end $$;

revoke execute on function app.organizer_add_guest(uuid,uuid,text,uuid,text,text) from public,anon;
revoke execute on function app.organizer_invite_guest(uuid,uuid,uuid,uuid) from public,anon;
revoke execute on function app.owner_allocate_household(uuid,uuid,uuid,date,date) from public,anon;
grant execute on function app.organizer_add_guest(uuid,uuid,text,uuid,text,text) to authenticated;
grant execute on function app.organizer_invite_guest(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function app.owner_allocate_household(uuid,uuid,uuid,date,date) to authenticated;
