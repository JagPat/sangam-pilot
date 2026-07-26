-- 0010_owner_setup_rpcs.sql
-- Self-serve setup for the wedding SHELL, so an organizer no longer needs the SQL editor to stand up a
-- wedding or its schedule. Venues stay plain owner_write RLS writes (simple columns); the pieces that need
-- help are: (a) BOOTSTRAPPING a brand-new wedding — the caller can't be its owner yet, so RLS can't let
-- them insert the wedding/owner rows (chicken-and-egg); and (b) the event_instance.arrival COMPOSITE
-- (app.zoned_time) with its offset math and CHECK constraints. Both go through SECURITY DEFINER functions.

-- ---------- create a brand-new wedding and make the caller its owner ----------
-- Any signed-in account may create a wedding; they can only ever create one they themselves own, so this is
-- safe to grant to `authenticated`. Order matters: membership must be 'active' before operator_role (the
-- enforce_active_membership trigger requires it).
create or replace function app.create_wedding(p_title text, p_couple text, p_tz text, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_acc uuid; v_wed uuid;
begin
  v_acc := app.current_account_id();
  if v_acc is null then raise exception 'must be signed in to create a wedding'; end if;
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'a wedding title is required'; end if;

  insert into app.wedding (title, couple_names, default_timezone, start_date, end_date)
  values (trim(p_title),
          nullif(trim(coalesce(p_couple, '')), ''),
          coalesce(nullif(trim(coalesce(p_tz, '')), ''), 'Asia/Kolkata'),
          p_start, p_end)
  returning id into v_wed;

  insert into app.wedding_membership (wedding_id, account_id, status) values (v_wed, v_acc, 'active');
  insert into app.operator_role (wedding_id, account_id, role) values (v_wed, v_acc, 'wedding_owner');
  return v_wed;
end $$;

-- ---------- wall-clock + IANA zone -> app.zoned_time (keeps instant, wall, offset, source) ----------
-- offset_minutes is +330 for IST, -240/-300 for US-Eastern, etc. (positive = east of UTC), matching the
-- arrival_valid CHECK range. Internal helper — only the definer functions below call it.
create or replace function app.build_zoned_time(p_wall timestamp, p_tz text, p_source text default 'host')
returns app.zoned_time language plpgsql stable set search_path = app, public as $$
declare v_instant timestamptz; v_off int;
begin
  v_instant := p_wall at time zone p_tz;                                          -- wall interpreted in p_tz -> UTC instant
  v_off := round(extract(epoch from ((p_wall at time zone 'UTC') - v_instant)) / 60);
  return row(v_instant, p_wall, v_off, coalesce(p_source, 'host'))::app.zoned_time;
end $$;

-- ---------- create an event = its function + one dated instance ----------
create or replace function app.owner_create_event(p_wedding uuid, p_name text, p_type text, p_venue uuid, p_wall timestamp, p_tz text)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_func uuid; v_inst uuid; v_tz text;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'an event name is required'; end if;
  if p_wall is null then raise exception 'an event date and time is required'; end if;

  v_tz := coalesce(nullif(trim(coalesce(p_tz, '')), ''),
                   (select default_timezone from app.wedding where id = p_wedding), 'Asia/Kolkata');

  insert into app.event_function (wedding_id, name, type)
  values (p_wedding, trim(p_name), coalesce(nullif(trim(coalesce(p_type, '')), ''), 'other'))
  returning id into v_func;

  insert into app.event_instance (wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status)
  values (p_wedding, v_func, p_venue, v_tz, app.build_zoned_time(p_wall, v_tz), 'scheduled')
  returning id into v_inst;

  return v_inst;
end $$;

-- ---------- edit an existing event (rename/retype its function; move time/venue; cancel) ----------
create or replace function app.owner_update_event(
  p_wedding uuid, p_instance uuid, p_name text, p_type text, p_venue uuid, p_wall timestamp, p_tz text, p_cancelled boolean
) returns void language plpgsql security definer set search_path = app, public as $$
declare v_func uuid; v_tz text;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;

  select event_function_id into v_func from app.event_instance where wedding_id = p_wedding and id = p_instance;
  if v_func is null then raise exception 'unknown event'; end if;

  v_tz := coalesce(nullif(trim(coalesce(p_tz, '')), ''),
                   (select iana_timezone from app.event_instance where id = p_instance), 'Asia/Kolkata');

  if p_name is not null and length(trim(p_name)) > 0 then
    update app.event_function
       set name = trim(p_name), type = coalesce(nullif(trim(coalesce(p_type, '')), ''), type)
     where wedding_id = p_wedding and id = v_func;
  end if;

  update app.event_instance
     set venue_id         = p_venue,
         iana_timezone    = v_tz,
         arrival          = case when p_wall is not null then app.build_zoned_time(p_wall, v_tz) else arrival end,
         scheduled_status = case when coalesce(p_cancelled, false) then 'cancelled'::app.scheduled_status
                                 else 'scheduled'::app.scheduled_status end
   where wedding_id = p_wedding and id = p_instance;
end $$;

-- ---------- least-privilege grants ----------
revoke execute on function app.build_zoned_time(timestamp, text, text) from public, anon, authenticated;

revoke execute on function app.create_wedding(text, text, text, date, date) from public, anon;
grant  execute on function app.create_wedding(text, text, text, date, date) to authenticated;

revoke execute on function app.owner_create_event(uuid, text, text, uuid, timestamp, text) from public, anon;
grant  execute on function app.owner_create_event(uuid, text, text, uuid, timestamp, text) to authenticated;

revoke execute on function app.owner_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean) from public, anon;
grant  execute on function app.owner_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean) to authenticated;
