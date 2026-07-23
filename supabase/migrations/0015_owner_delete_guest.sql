-- 0015_owner_delete_guest.sql
-- Atomic, owner-only guest deletion.
--
-- Why: the /host/manage "Delete guest" action previously deleted app.household_contact and then app.guest
-- in TWO separate PostgREST calls (two transactions). ~18 tables reference app.guest with ON DELETE NO
-- ACTION, so the guest delete can fail — e.g. a guest_dietary_profile row from the M8 dietary feature, a
-- directory_consent row, an access link, or being a household's primary contact — AFTER the contact row
-- was already deleted. That left the guest in place with their sign-in email silently wiped, and made the
-- delete unreachable for any guest who has dietary data.
--
-- This SECURITY DEFINER function does the whole thing in ONE transaction: it authorizes the caller as the
-- wedding owner, preserves the existing "remove from events first" guard (a guest still invited anywhere
-- cannot be deleted; their RSVP/audit trail stays intact), then detaches/removes the guest's owned detail
-- rows and the guest itself atomically. Any failure rolls the entire operation back — no partial state,
-- no silent data loss. Reads/writes are all scoped by p_wedding.

create or replace function app.owner_delete_guest(p_wedding uuid, p_guest uuid)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
  if not app.is_wedding_owner(p_wedding) then
    raise exception 'not authorized to manage this wedding' using errcode = '42501';
  end if;

  if not exists (select 1 from app.guest g where g.wedding_id = p_wedding and g.id = p_guest) then
    raise exception 'guest not found' using errcode = 'P0002';
  end if;

  -- Non-destructive guard: a guest invited to any event must be removed from those events first, so their
  -- attendance history is never destroyed from here. Signalled with a distinct SQLSTATE the app maps to a
  -- friendly "remove from their events first" message.
  if exists (select 1 from app.invitation_guest ig where ig.wedding_id = p_wedding and ig.guest_id = p_guest) then
    raise exception 'guest still invited to one or more events' using errcode = 'SA001';
  end if;

  -- Detach references that should survive the guest (audit/import rows, household pointer)...
  update app.household        set primary_contact_id = null where wedding_id = p_wedding and primary_contact_id = p_guest;
  update app.guest_import_row set resolved_guest_id  = null where wedding_id = p_wedding and resolved_guest_id  = p_guest;

  -- ...then remove the guest's owned detail rows (child-first where one detail references another)...
  delete from app.delegation_notification_recipient where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.guest_delegation      where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.guardian_assignment   where wedding_id = p_wedding and (guardian_guest_id = p_guest or minor_guest_id = p_guest);
  delete from app.invitation_plus_one   where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.meal_override         where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.notice_acknowledgement    where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.schedule_acknowledgement  where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.operational_preference    where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.consent_record        where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.directory_consent     where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.guest_tag_assignment  where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.guest_access_link     where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.guest_dietary_profile where wedding_id = p_wedding and guest_id = p_guest;
  delete from app.household_contact     where wedding_id = p_wedding and guest_id = p_guest;

  -- ...and finally the guest. Anything still referencing it (an unforeseen child) raises here and rolls
  -- the whole transaction back, so we never leave a half-deleted guest.
  delete from app.guest where wedding_id = p_wedding and id = p_guest;
end;
$$;

revoke all on function app.owner_delete_guest(uuid, uuid) from public;
grant execute on function app.owner_delete_guest(uuid, uuid) to authenticated;
