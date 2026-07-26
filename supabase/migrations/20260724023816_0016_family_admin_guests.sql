-- 0016_family_admin_guests.sql
-- Layer 1 of family-admin "full co-manage, own-side-only": a host_group_admin / co_host can manage the
-- GUESTS on their own side, and READ the event schedule (so they can invite their guests). Every scope is
-- keyed off app.household.host_group_id — a household's "side" — and gated by app.is_group_admin, so a
-- bride-side admin can never see or touch a groom-side household, guest, contact, invitation, or dietary
-- row. Owner policies are untouched (permissive policies OR together); this only ADDS access for admins.
--
-- IMPORTANT: the side-scoping is evaluated through SECURITY DEFINER helpers, NOT inline subqueries. A policy
-- on `guest` that inline-selected from `household` would re-trigger household's RLS and recurse ("infinite
-- recursion detected in policy"). Definer helpers run with the owner's rights (RLS bypassed inside), exactly
-- like is_wedding_owner / is_invited_to_instance already do. Editing events is a later layer (read-only here).

-- Caller is a family admin (host_group_admin OR co_host) of ANY group in this wedding — used to grant read
-- access to the shared schedule (all events), which admins need in order to invite their guests.
create or replace function app.is_any_group_admin(p_wedding uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
    where r.wedding_id = p_wedding and r.account_id = app.current_account_id()
      and r.role in ('host_group_admin','co_host')
  );
$$;

-- The caller admins the side that owns this household (NULL side => no match => owner-only).
create or replace function app.can_admin_household(p_wedding uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.household h
    where h.wedding_id = p_wedding and h.id = p_household
      and app.is_group_admin(h.wedding_id, h.host_group_id)
  );
$$;

-- The caller admins the side that owns this guest (via the guest's household).
create or replace function app.can_admin_guest(p_wedding uuid, p_guest uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.guest g
      join app.household h on h.wedding_id = g.wedding_id and h.id = g.household_id
    where g.wedding_id = p_wedding and g.id = p_guest
      and app.is_group_admin(h.wedding_id, h.host_group_id)
  );
$$;

-- The caller admins the side of the guest behind this invitation_guest (for attendance reads).
create or replace function app.can_admin_invitation_guest(p_wedding uuid, p_ig uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.invitation_guest ig
      join app.guest g on g.wedding_id = ig.wedding_id and g.id = ig.guest_id
      join app.household h on h.wedding_id = g.wedding_id and h.id = g.household_id
    where ig.wedding_id = p_wedding and ig.id = p_ig
      and app.is_group_admin(h.wedding_id, h.host_group_id)
  );
$$;

-- ---------- guests + households on the admin's side (full read/write) ----------
create policy household_group_admin_all on app.household for all
  using      (app.is_group_admin(wedding_id, host_group_id))
  with check (app.is_group_admin(wedding_id, host_group_id));

create policy guest_group_admin_all on app.guest for all
  using      (app.can_admin_household(wedding_id, household_id))
  with check (app.can_admin_household(wedding_id, household_id));

create policy contact_group_admin_all on app.household_contact for all
  using      (app.can_admin_household(wedding_id, household_id))
  with check (app.can_admin_household(wedding_id, household_id));

create policy invitation_group_admin_all on app.invitation for all
  using      (app.can_admin_household(wedding_id, household_id))
  with check (app.can_admin_household(wedding_id, household_id));

create policy ig_group_admin_all on app.invitation_guest for all
  using      (app.can_admin_guest(wedding_id, guest_id))
  with check (app.can_admin_guest(wedding_id, guest_id));

create policy diet_group_admin_all on app.guest_dietary_profile for all
  using      (app.can_admin_guest(wedding_id, guest_id))
  with check (app.can_admin_guest(wedding_id, guest_id));

-- attendance of the admin's own-side guests (READ ONLY; RSVPs are still written only via propose/confirm).
create policy att_group_admin_read on app.event_attendance for select
  using (app.can_admin_invitation_guest(wedding_id, invitation_guest_id));

-- ---------- the shared schedule: READ-ONLY for family admins (so they can invite their guests) ----------
create policy einst_group_admin_read on app.event_instance   for select using (app.is_any_group_admin(wedding_id));
create policy efunc_group_admin_read on app.event_function    for select using (app.is_any_group_admin(wedding_id));
create policy venue_group_admin_read on app.venue             for select using (app.is_any_group_admin(wedding_id));
create policy ehg_group_admin_read   on app.event_host_group  for select using (app.is_any_group_admin(wedding_id));

-- is_group_admin is called DIRECTLY (not via a definer helper) in the household policy above, so the
-- authenticated role needs execute on it. (0001 created it but only granted the definer helpers that used
-- it internally.) Idempotent if a blanket grant already covers it.
grant execute on function app.is_group_admin(uuid, uuid) to authenticated;

revoke all on function app.is_any_group_admin(uuid)            from public;
revoke all on function app.can_admin_household(uuid, uuid)     from public;
revoke all on function app.can_admin_guest(uuid, uuid)         from public;
revoke all on function app.can_admin_invitation_guest(uuid, uuid) from public;
grant execute on function app.is_any_group_admin(uuid)            to authenticated;
grant execute on function app.can_admin_household(uuid, uuid)     to authenticated;
grant execute on function app.can_admin_guest(uuid, uuid)         to authenticated;
grant execute on function app.can_admin_invitation_guest(uuid, uuid) to authenticated;
