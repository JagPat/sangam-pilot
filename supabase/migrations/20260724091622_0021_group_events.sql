-- 0021_group_events.sql
-- Family-admin scoped events. A bride/groom-side admin (host_group_admin) can create events their side hosts,
-- and edit / cancel events their side hosts — mirroring the owner's event RPCs but authorized against the
-- caller's own host group instead of wedding ownership. They cannot touch the other side's events, and they
-- cannot reassign which families host an event (that stays with the owner). Venue creation also stays owner-
-- only; a family admin picks from existing venues. Reads already exist (0016 gives group admins read on
-- event_function / event_instance / event_host_group / venue), so this adds only the two write RPCs + a
-- can-admin-event helper. SECURITY DEFINER, so no direct table write policies are needed.

-- owner, or a group admin of any of the event's hosting families
create or replace function app.can_admin_event(p_wedding uuid, p_instance uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_wedding_owner(p_wedding) or exists (
    select 1 from app.event_host_group ehg
    where ehg.wedding_id = p_wedding and ehg.event_instance_id = p_instance
      and app.is_group_admin(p_wedding, ehg.host_group_id)
  );
$$;

-- ---------- a family admin creates an event hosted by THEIR side ----------
create or replace function app.group_create_event(
  p_wedding uuid, p_host_group uuid, p_name text, p_type text, p_venue uuid, p_wall timestamp, p_tz text,
  p_dress text default null, p_muhurat_wall timestamp default null, p_tithi text default null,
  p_choghadiya text default null, p_stream text default null
) returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_func uuid; v_inst uuid; v_tz text;
begin
  if not app.is_group_admin(p_wedding, p_host_group) then raise exception 'not authorized to manage this side'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'an event name is required'; end if;
  if p_wall is null then raise exception 'an event date and time is required'; end if;
  if p_venue is not null and not exists (select 1 from app.venue where wedding_id = p_wedding and id = p_venue) then
    raise exception 'unknown venue for this wedding';
  end if;

  v_tz := coalesce(nullif(trim(coalesce(p_tz, '')), ''),
                   (select default_timezone from app.wedding where id = p_wedding), 'Asia/Kolkata');

  insert into app.event_function (wedding_id, name, type)
  values (p_wedding, trim(p_name), coalesce(nullif(trim(coalesce(p_type, '')), ''), 'other'))
  returning id into v_func;

  insert into app.event_instance (
    wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status,
    dress_code, muhurat_kind, muhurat_start, tithi_text, choghadiya_text, stream_url
  )
  values (
    p_wedding, v_func, p_venue, v_tz, app.build_zoned_time(p_wall, v_tz), 'scheduled',
    nullif(trim(coalesce(p_dress, '')), ''),
    case when p_muhurat_wall is not null then 'instant'::app.muhurat_kind else null end,
    case when p_muhurat_wall is not null then app.build_zoned_time(p_muhurat_wall, v_tz) else null end,
    nullif(trim(coalesce(p_tithi, '')), ''), nullif(trim(coalesce(p_choghadiya, '')), ''), nullif(trim(coalesce(p_stream, '')), '')
  )
  returning id into v_inst;

  -- their side hosts it (they can only pass a group they admin — asserted above)
  perform app.set_event_host_groups(p_wedding, v_inst, array[p_host_group]);
  return v_inst;
end $$;

-- ---------- a family admin edits / cancels an event their side hosts (no host-group reassignment) ----------
create or replace function app.group_update_event(
  p_wedding uuid, p_instance uuid, p_name text, p_type text, p_venue uuid, p_wall timestamp, p_tz text, p_cancelled boolean,
  p_dress text default null, p_muhurat_wall timestamp default null, p_tithi text default null,
  p_choghadiya text default null, p_stream text default null
) returns void language plpgsql security definer set search_path = app, public as $$
declare v_func uuid; v_tz text;
begin
  if not app.can_admin_event(p_wedding, p_instance) then raise exception 'not authorized to manage this event'; end if;

  select event_function_id into v_func from app.event_instance where wedding_id = p_wedding and id = p_instance;
  if v_func is null then raise exception 'unknown event'; end if;
  if p_venue is not null and not exists (select 1 from app.venue where wedding_id = p_wedding and id = p_venue) then
    raise exception 'unknown venue for this wedding';
  end if;

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
                                 else 'scheduled'::app.scheduled_status end,
         dress_code       = nullif(trim(coalesce(p_dress, '')), ''),
         muhurat_kind     = case when p_muhurat_wall is not null then 'instant'::app.muhurat_kind else null end,
         muhurat_start    = case when p_muhurat_wall is not null then app.build_zoned_time(p_muhurat_wall, v_tz) else null end,
         muhurat_end      = null,
         tithi_text       = nullif(trim(coalesce(p_tithi, '')), ''),
         choghadiya_text  = nullif(trim(coalesce(p_choghadiya, '')), ''),
         stream_url       = nullif(trim(coalesce(p_stream, '')), '')
   where wedding_id = p_wedding and id = p_instance;
end $$;

-- ---------- least-privilege grants ----------
revoke execute on function app.can_admin_event(uuid, uuid) from public, anon;
grant  execute on function app.can_admin_event(uuid, uuid) to authenticated;
revoke execute on function app.group_create_event(uuid, uuid, text, text, uuid, timestamp, text, text, timestamp, text, text, text) from public, anon;
grant  execute on function app.group_create_event(uuid, uuid, text, text, uuid, timestamp, text, text, timestamp, text, text, text) to authenticated;
revoke execute on function app.group_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean, text, timestamp, text, text, text) from public, anon;
grant  execute on function app.group_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean, text, timestamp, text, text, text) to authenticated;
