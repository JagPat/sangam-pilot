-- 0007_grants.sql
-- Least-privilege grants. RLS is the row filter; these grants decide which COMMANDS a role may attempt.
-- Assumes Supabase's standard roles (anon, authenticated, service_role). Locally: run 00_roles.sql first.

-- schema reach (anon never touches app: the invite route runs server-side as service_role)
grant usage on schema app to authenticated, service_role;

-- service_role is the trusted server path (bypasses RLS): full DML + execute
grant select, insert, update, delete on all tables in schema app to service_role;
grant execute on all functions in schema app to service_role;

-- authenticated: SELECT everywhere (RLS scopes the rows)
grant select on all tables in schema app to authenticated;

-- authenticated DML: hosts and guests must be able to WRITE (RLS owner_write / self policies gate who &
-- which rows). Granted broadly, then the function/service-managed tables are revoked below.
grant insert, update, delete on all tables in schema app to authenticated;

-- ...but these are written ONLY by SECURITY DEFINER functions or service_role. RLS already denies (no
-- write policy); revoking the privilege too is defense-in-depth and makes the intent explicit.
revoke insert, update, delete on
  app.event_attendance, app.rsvp_proposal, app.rsvp_change_log, app.audit_event,
  app.guest_access_link, app.guest_import_batch, app.guest_import_row
  from authenticated;

-- ---------- function execution: WHITELIST for authenticated ----------
-- Default CREATE FUNCTION grants EXECUTE to PUBLIC. Strip it from PUBLIC and authenticated, then grant
-- only what authenticated legitimately needs: the helpers RLS policies call, plus host link issuance.
revoke execute on all functions in schema app from public, authenticated;
alter default privileges in schema app revoke execute on functions from public;

grant execute on function
  app.current_account_id(),
  app.is_member(uuid),
  app.is_wedding_owner(uuid),
  app.can_act_for_guest(uuid),
  app.is_captain_of_household(uuid, uuid),
  app.is_invited_to_instance(uuid, uuid),
  app.issue_access_link(uuid, uuid, text, interval)
  to authenticated;
-- NOTE: redeem_and_bind / bind_guest_account are NOT granted to authenticated — they are service-only
-- (called from the server-side invite exchange as service_role).

-- append-only audit (belt-and-suspenders on top of the revoke above)
revoke insert, update, delete on app.audit_event from anon;

-- ---------- public RPC wrappers (PostgREST-exposed), SECURITY DEFINER ----------
-- authenticated calls these; they run as owner and forward to the app.* SECURITY DEFINER functions, so
-- authenticated needs execute on the WRAPPERS only (not on app.propose/confirm).
-- NOTE: the authenticated wrapper takes ONLY (invitation_guest, status). It does not expose the transport
-- channel (it defaults to 'web' in app.*) and it does not accept an acting authority — the authority is
-- DERIVED server-side (app.derive_rsvp_authority). So an authenticated caller can forge neither the
-- channel ('whatsapp'/'import' stay service-role-only) nor the basis ('self'/'delegate'/'operator').
create or replace function public.propose_rsvp_change(
  p_invitation_guest uuid, p_status app.attendance_status
) returns uuid language sql security definer set search_path = app, public as $$
  select app.propose_rsvp_change(p_invitation_guest, p_status);   -- channel defaults to 'web'; authority derived
$$;

create or replace function public.confirm_rsvp_change(
  p_proposal uuid, p_expected_version integer default null
) returns uuid language sql security definer set search_path = app, public as $$
  select app.confirm_rsvp_change(p_proposal, p_expected_version);
$$;

revoke execute on function public.propose_rsvp_change(uuid, app.attendance_status) from public;
revoke execute on function public.confirm_rsvp_change(uuid, integer) from public;
-- Supabase's default privileges GRANT EXECUTE on new `public` functions directly to anon & authenticated,
-- so the `from public` revokes above do NOT strip anon's direct grant. Revoke from anon explicitly — the
-- wrappers are for signed-in users only (the inner app.* functions reject a null identity, but anon should
-- not be able to invoke the RPC at all). Verified live via has_function_privilege.
revoke execute on function public.propose_rsvp_change(uuid, app.attendance_status) from anon;
revoke execute on function public.confirm_rsvp_change(uuid, integer) from anon;
grant  execute on function public.propose_rsvp_change(uuid, app.attendance_status) to authenticated;
grant  execute on function public.confirm_rsvp_change(uuid, integer) to authenticated;
