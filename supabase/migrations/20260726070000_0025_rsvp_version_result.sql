-- Return the committed attendance version from the browser-facing confirmation RPC.
-- Without this, a second RSVP change in the same browser session reuses a stale
-- optimistic-concurrency version and is rejected even though the first write succeeded.

drop function public.confirm_rsvp_change(uuid, integer);

create function public.confirm_rsvp_change(
  p_proposal uuid, p_expected_version integer default null
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare
  v_attendance_id uuid;
  v_row_version integer;
begin
  v_attendance_id := app.confirm_rsvp_change(p_proposal, p_expected_version);

  select ea.row_version
    into strict v_row_version
    from app.event_attendance ea
   where ea.id = v_attendance_id;

  return jsonb_build_object(
    'attendance_id', v_attendance_id,
    'row_version', v_row_version
  );
end $$;

revoke execute on function public.confirm_rsvp_change(uuid, integer) from public, anon;
grant execute on function public.confirm_rsvp_change(uuid, integer) to authenticated;
