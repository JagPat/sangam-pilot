-- 0047_server_invite_issuance.sql
-- Host invite issuance is a service-only command. The verified actor is supplied by trusted server code;
-- PostgreSQL independently proves their active owner role and chooses the recipient + lifetime.

revoke execute on function app.issue_guest_access_link(uuid, uuid, interval) from public, anon, authenticated, service_role;
drop function app.issue_guest_access_link(uuid, uuid, interval);

create function app.issue_guest_access_link(
  p_actor uuid,
  p_wedding uuid,
  p_guest uuid
) returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_contact text;
  v_contact_count integer := 0;
  v_raw text;
  v_issued_at timestamptz := now();
begin
  perform 1
    from app.wedding_membership membership
    join app.operator_role role
      on role.wedding_id = membership.wedding_id
     and role.account_id = membership.account_id
   where membership.wedding_id = p_wedding
     and membership.account_id = p_actor
     and membership.status = 'active'
     and role.role = 'wedding_owner'
   for update of membership, role;
  if not found then
    raise exception 'not authorized to issue links' using errcode = '42501';
  end if;

  perform 1 from app.guest where wedding_id = p_wedding and id = p_guest for update;
  if not found then raise exception 'guest not found' using errcode = 'P0002'; end if;

  for v_contact in
    select value
      from app.household_contact
     where wedding_id = p_wedding
       and guest_id = p_guest
       and channel = 'email'
       and is_shared = false
     for update
  loop
    v_contact_count := v_contact_count + 1;
    if v_contact_count > 1 then
      raise exception 'guest has multiple personal sign-in emails; resolve contact before issuing a link'
        using errcode = '22023';
    end if;
  end loop;
  if v_contact_count <> 1 or nullif(trim(v_contact), '') is null then
    raise exception 'guest must have exactly one personal sign-in email' using errcode = '22023';
  end if;

  v_raw := encode(gen_random_bytes(32), 'hex');
  insert into app.guest_access_link(
    wedding_id, guest_id, token_hash, contact_hash, issued_at, expires_at
  ) values (
    p_wedding,
    p_guest,
    encode(digest(v_raw, 'sha256'), 'hex'),
    encode(digest(lower(trim(v_contact)), 'sha256'), 'hex'),
    v_issued_at,
    v_issued_at + interval '30 days'
  );
  return v_raw;
end $$;

revoke execute on function app.issue_guest_access_link(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.issue_guest_access_link(uuid, uuid, uuid) to service_role;
