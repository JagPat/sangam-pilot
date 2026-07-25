-- 0023_review_hardening.sql
-- Close two authorization gaps found in the post-0022 review:
--   1. a side admin could rename an event_function shared by an instance hosted by another side;
--   2. any wedding member could append caller-authored stay_activity that looked like manager activity.

-- A side admin may edit their instance, but may only mutate the shared function name/type when every
-- instance using that function is also within their administrative scope. Wedding owners remain able to
-- manage the full wedding through this function because can_admin_event is true for every instance.
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
    if exists (
      select 1
        from app.event_instance shared_instance
       where shared_instance.wedding_id = p_wedding
         and shared_instance.event_function_id = v_func
         and shared_instance.id <> p_instance
         and not app.can_admin_event(p_wedding, shared_instance.id)
    ) then
      raise exception 'event name/type is shared with an event outside your scope';
    end if;

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

-- The logger remains callable by authenticated app actions, but it no longer trusts a member assertion or
-- caller-authored text. Owners may record manager actions. Guests/proxies may only record the three
-- self-service actions against an authoritative row they can act for; their summary is derived from data.
create or replace function app.log_stay_activity(
  p_wedding uuid, p_action app.stay_action, p_summary text,
  p_household uuid default null, p_guest uuid default null
) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_summary text;
begin
  if app.is_wedding_owner(p_wedding) then
    if p_household is not null and not exists (
      select 1 from app.household where wedding_id = p_wedding and id = p_household
    ) then
      raise exception 'unknown household for this wedding';
    end if;
    if p_guest is not null and not exists (
      select 1 from app.guest where wedding_id = p_wedding and id = p_guest
    ) then
      raise exception 'unknown guest for this wedding';
    end if;
    v_summary := nullif(left(trim(coalesce(p_summary, '')), 500), '');
    if v_summary is null then raise exception 'activity summary is required'; end if;
  elsif p_action = 'stay_request'
        and p_household is not null
        and p_guest is null
        and app.can_act_for_household(p_wedding, p_household) then
    select 'Room request: ' || status::text
      into v_summary
      from app.stay_request
     where wedding_id = p_wedding and household_id = p_household;
  elsif p_action = 'travel'
        and p_guest is not null
        and p_household is null
        and app.can_act_for_guest(p_guest)
        and exists (
          select 1 from app.travel_detail where wedding_id = p_wedding and guest_id = p_guest
        ) then
    v_summary := 'Travel details updated';
  elsif p_action = 'service_request'
        and p_household is not null
        and (
          (p_guest is not null and app.can_act_for_guest(p_guest))
          or (p_guest is null and app.can_act_for_household(p_wedding, p_household))
        )
        and exists (
          select 1
            from app.service_request
           where wedding_id = p_wedding
             and household_id = p_household
             and (p_guest is null or guest_id = p_guest)
             and status <> 'cancelled'
        ) then
    v_summary := 'Requested a service';
  else
    raise exception 'not authorized to log this stay activity';
  end if;

  if v_summary is null then raise exception 'not authorized to log this stay activity'; end if;

  insert into app.stay_activity(wedding_id, actor_account_id, action, summary, household_id, guest_id)
  values (p_wedding, app.current_account_id(), p_action, v_summary, p_household, p_guest);
end;
$$;

revoke all on function app.group_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean, text, timestamp, text, text, text) from public, anon;
grant execute on function app.group_update_event(uuid, uuid, text, text, uuid, timestamp, text, boolean, text, timestamp, text, text, text) to authenticated;
revoke all on function app.log_stay_activity(uuid, app.stay_action, text, uuid, uuid) from public, anon;
grant execute on function app.log_stay_activity(uuid, app.stay_action, text, uuid, uuid) to authenticated;
