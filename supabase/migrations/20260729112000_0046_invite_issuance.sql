-- 0046_invite_issuance.sql
-- Only the database may choose the recipient contact for an authenticated host-issued invite.

create or replace function app.issue_guest_access_link(
  p_wedding uuid,
  p_guest uuid,
  p_ttl interval default interval '30 days'
) returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare v_contact text; v_contact_count integer := 0;
begin
  if not app.is_wedding_owner(p_wedding) then
    raise exception 'not authorized to issue links' using errcode = '42501';
  end if;

  perform 1 from app.guest where wedding_id = p_wedding and id = p_guest for update;
  if not found then raise exception 'guest not found' using errcode = 'P0002'; end if;

  for v_contact in
    select value from app.household_contact
     where wedding_id = p_wedding and guest_id = p_guest and channel = 'email'
     for update
  loop
    v_contact_count := v_contact_count + 1;
    if v_contact_count > 1 then
      raise exception 'guest has multiple sign-in emails; resolve contact before issuing a link' using errcode = '22023';
    end if;
  end loop;
  if v_contact_count <> 1 or nullif(trim(v_contact), '') is null then
    raise exception 'guest has no sign-in email' using errcode = '22023';
  end if;

  return app.issue_access_link(p_wedding, p_guest, v_contact, p_ttl);
end $$;

revoke execute on function app.issue_access_link(uuid, uuid, text, interval) from public, anon, authenticated;
grant execute on function app.issue_access_link(uuid, uuid, text, interval) to service_role;
revoke execute on function app.issue_guest_access_link(uuid, uuid, interval) from public, anon;
grant execute on function app.issue_guest_access_link(uuid, uuid, interval) to authenticated, service_role;
