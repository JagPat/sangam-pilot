-- Preserve the submitted travel wall clock and IANA zone. Derive the UTC
-- instant in PostgreSQL instead of interpreting datetime-local in the browser.
alter table app.travel_detail
  add column wall_local timestamp,
  add column iana_timezone text,
  add column offset_minutes integer;

update app.travel_detail
   set wall_local = at_instant at time zone 'UTC', iana_timezone = 'UTC', offset_minutes = 0
 where at_instant is not null;

alter table app.travel_detail add constraint travel_zoned_time_complete check (
  (at_instant is null and wall_local is null and iana_timezone is null and offset_minutes is null)
  or (at_instant is not null and wall_local is not null and iana_timezone is not null
      and offset_minutes between -840 and 840)
);

create or replace function app.save_my_travel(
  p_wedding uuid, p_guest uuid, p_direction app.travel_dir, p_mode app.travel_mode,
  p_wall timestamp, p_timezone text, p_carrier text, p_number text, p_from_place text,
  p_arranged_by app.arranged_by, p_needs_pickup boolean, p_luggage_note text
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v_zoned app.zoned_time; v_id uuid;
begin
  if not exists (
    select 1 from app.guest g where g.wedding_id=p_wedding and g.id=p_guest
      and app.can_act_for_guest(g.id)
  ) then raise exception 'not authorized to update this travel record'; end if;

  if p_wall is null then
    if nullif(trim(coalesce(p_timezone,'')), '') is not null then
      raise exception 'timezone requires a travel date and time';
    end if;
  else
    if not exists (select 1 from pg_timezone_names where name=p_timezone) then
      raise exception 'unknown IANA timezone %', p_timezone;
    end if;
    v_zoned := app.build_zoned_time(p_wall, p_timezone, 'guest');
  end if;

  insert into app.travel_detail (
    wedding_id,guest_id,direction,mode,at_instant,wall_local,iana_timezone,offset_minutes,
    carrier,number,from_place,arranged_by,needs_pickup,luggage_note,updated_at
  ) values (
    p_wedding,p_guest,p_direction,p_mode,(v_zoned).instant,(v_zoned).wall_local,
    case when p_wall is null then null else p_timezone end,(v_zoned).offset_minutes,
    nullif(trim(coalesce(p_carrier,'')),''),nullif(trim(coalesce(p_number,'')),''),
    nullif(trim(coalesce(p_from_place,'')),''),coalesce(p_arranged_by,'self'),
    coalesce(p_needs_pickup,false),nullif(trim(coalesce(p_luggage_note,'')),''),now()
  ) on conflict (wedding_id,guest_id,direction) do update set
    mode=excluded.mode,at_instant=excluded.at_instant,wall_local=excluded.wall_local,
    iana_timezone=excluded.iana_timezone,offset_minutes=excluded.offset_minutes,
    carrier=excluded.carrier,number=excluded.number,from_place=excluded.from_place,
    arranged_by=excluded.arranged_by,needs_pickup=excluded.needs_pickup,
    luggage_note=excluded.luggage_note,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function app.save_my_travel(uuid,uuid,app.travel_dir,app.travel_mode,timestamp,text,text,text,text,app.arranged_by,boolean,text) from public,anon;
grant execute on function app.save_my_travel(uuid,uuid,app.travel_dir,app.travel_mode,timestamp,text,text,text,text,app.arranged_by,boolean,text) to authenticated;
