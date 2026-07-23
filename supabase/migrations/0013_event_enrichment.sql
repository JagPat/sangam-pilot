-- 0013_event_enrichment.sql
-- Phase 2: let the organizer set the "know before you go" enrichment (dress code, muhurat, tithi/choghadiya,
-- live stream) AND assign each event to its hosting families (event_host_group -> the two-family accent on
-- the guest card + the finance split), all from /host/setup. Extends the owner event RPCs.
--
-- Venue map links are a plain owner_write RLS insert (the venue.map_url column already exists) — handled in
-- the app, no SQL here.
--
-- Postgres can't add parameters via CREATE OR REPLACE, so we DROP the old signatures and recreate. The
-- existing parameters behave exactly as before; every NEW parameter defaults to null, so the currently
-- deployed app (which calls the 6-/8-arg forms) keeps working against these functions with no change.

drop function if exists app.owner_create_event(uuid, text, text, uuid, timestamp, text);
drop function if exists app.owner_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean);

-- Replace an instance's hosting families with the given set, validated to this wedding. null = leave
-- unchanged; an empty array clears. Internal only (SECURITY DEFINER, revoked from every role) — reached
-- solely via the owner RPCs below, which have already checked is_wedding_owner.
create or replace function app.set_event_host_groups(p_wedding uuid, p_instance uuid, p_groups uuid[])
returns void language plpgsql security definer set search_path = app, public as $$
begin
  if p_groups is null then return; end if;
  delete from app.event_host_group where wedding_id = p_wedding and event_instance_id = p_instance;
  insert into app.event_host_group (wedding_id, event_instance_id, host_group_id)
  select p_wedding, p_instance, g
  from unnest(p_groups) as g
  where exists (select 1 from app.host_group h where h.wedding_id = p_wedding and h.id = g)
  on conflict do nothing;
end $$;

-- ---------- create an event = its function + one dated instance (+ enrichment + hosting families) ----------
create or replace function app.owner_create_event(
  p_wedding uuid, p_name text, p_type text, p_venue uuid, p_wall timestamp, p_tz text,
  p_dress text default null, p_muhurat_wall timestamp default null, p_tithi text default null,
  p_choghadiya text default null, p_stream text default null, p_host_groups uuid[] default null
) returns uuid language plpgsql security definer set search_path = app, public as $$
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

  insert into app.event_instance (
    wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status,
    dress_code, muhurat_kind, muhurat_start, tithi_text, choghadiya_text, stream_url
  )
  values (
    p_wedding, v_func, p_venue, v_tz, app.build_zoned_time(p_wall, v_tz), 'scheduled',
    nullif(trim(coalesce(p_dress, '')), ''),
    case when p_muhurat_wall is not null then 'instant'::app.muhurat_kind else null end,
    case when p_muhurat_wall is not null then app.build_zoned_time(p_muhurat_wall, v_tz) else null end,
    nullif(trim(coalesce(p_tithi, '')), ''),
    nullif(trim(coalesce(p_choghadiya, '')), ''),
    nullif(trim(coalesce(p_stream, '')), '')
  )
  returning id into v_inst;

  perform app.set_event_host_groups(p_wedding, v_inst, p_host_groups);
  return v_inst;
end $$;

-- ---------- edit an event (rename/retype; move time/venue; cancel; enrichment; hosting families) ----------
create or replace function app.owner_update_event(
  p_wedding uuid, p_instance uuid, p_name text, p_type text, p_venue uuid, p_wall timestamp, p_tz text, p_cancelled boolean,
  p_dress text default null, p_muhurat_wall timestamp default null, p_tithi text default null,
  p_choghadiya text default null, p_stream text default null, p_host_groups uuid[] default null
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
                                 else 'scheduled'::app.scheduled_status end,
         dress_code       = nullif(trim(coalesce(p_dress, '')), ''),
         muhurat_kind     = case when p_muhurat_wall is not null then 'instant'::app.muhurat_kind else null end,
         muhurat_start    = case when p_muhurat_wall is not null then app.build_zoned_time(p_muhurat_wall, v_tz) else null end,
         muhurat_end      = null,
         tithi_text       = nullif(trim(coalesce(p_tithi, '')), ''),
         choghadiya_text  = nullif(trim(coalesce(p_choghadiya, '')), ''),
         stream_url       = nullif(trim(coalesce(p_stream, '')), '')
   where wedding_id = p_wedding and id = p_instance;

  perform app.set_event_host_groups(p_wedding, p_instance, p_host_groups);
end $$;

-- ---------- least-privilege grants (new signatures) ----------
revoke execute on function app.set_event_host_groups(uuid, uuid, uuid[]) from public, anon, authenticated;

revoke execute on function app.owner_create_event(uuid, text, text, uuid, timestamp, text, text, timestamp, text, text, text, uuid[]) from public, anon;
grant  execute on function app.owner_create_event(uuid, text, text, uuid, timestamp, text, text, timestamp, text, text, text, uuid[]) to authenticated;

revoke execute on function app.owner_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean, text, timestamp, text, text, text, uuid[]) from public, anon;
grant  execute on function app.owner_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean, text, timestamp, text, text, text, uuid[]) to authenticated;
