-- 0020_stay_oversight.sql
-- Stay & Travel, layer 4: family-admin oversight. A bride/groom-side admin (host_group_admin) gets a
-- READ-ONLY window into stay, travel and services for households/guests on THEIR side, and every family can
-- see an activity log of what the event manager (and guests) have been doing — the answer to "how does the
-- bride's family monitor the event manager's activity". Room control, pickups and settlement stay owner-only
-- (central coordination); families get visibility, not a second set of hands. All scoping reuses the 0016
-- side helpers (is_any_group_admin, can_admin_household, can_admin_guest) — additive SELECT policies only, so
-- nothing an owner or guest could already do changes.

-- ---------- family-admin READ, scoped to their side ----------
-- shared inventory + menu are readable by any side admin so their own rows make sense
create policy hotel_group_admin_read on app.hotel for select using (app.is_any_group_admin(wedding_id));
create policy room_group_admin_read  on app.room  for select using (app.is_any_group_admin(wedding_id));
-- side-scoped rows: only the admin of that household's / guest's side
create policy alloc_group_admin_read   on app.room_allocation for select using (app.can_admin_household(wedding_id, household_id));
create policy occ_group_admin_read     on app.room_occupant   for select using (app.can_admin_guest(wedding_id, guest_id));
create policy stayreq_group_admin_read on app.stay_request    for select using (app.can_admin_household(wedding_id, household_id));
create policy travel_group_admin_read  on app.travel_detail   for select using (app.can_admin_guest(wedding_id, guest_id));
create policy servreq_group_admin_read on app.service_request for select using (
  (guest_id is not null and app.can_admin_guest(wedding_id, guest_id))
  or (guest_id is null and app.can_admin_household(wedding_id, household_id))
);
-- (the service catalogue is already member-readable via 0019's service_read, and family admins are members)

-- ---------- oversight activity log ----------
create type app.stay_action as enum (
  'room_allocated','room_released','room_status','pickup','stay_request','travel',
  'service_added','service_updated','service_request','service_settled'
);

create table app.stay_activity (
  id               uuid not null default gen_random_uuid(),
  wedding_id       uuid not null references app.wedding(id) on delete cascade,
  actor_account_id uuid,
  action           app.stay_action not null,
  summary          text not null,
  household_id     uuid,   -- side scoping (null ⇒ a wedding-level entry, visible to any side admin)
  guest_id         uuid,   -- side scoping
  created_at       timestamptz not null default now(),
  primary key (id)
);
create index stay_activity_by_wedding on app.stay_activity (wedding_id, created_at desc);

-- The only writer. SECURITY DEFINER so an owner OR a guest booking can append an entry without a table grant;
-- guarded so a caller can only log against a wedding they belong to.
create or replace function app.log_stay_activity(
  p_wedding uuid, p_action app.stay_action, p_summary text,
  p_household uuid default null, p_guest uuid default null
) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_member(p_wedding) then return; end if;
  insert into app.stay_activity(wedding_id, actor_account_id, action, summary, household_id, guest_id)
  values (p_wedding, app.current_account_id(), p_action, p_summary, p_household, p_guest);
end;
$$;

alter table app.stay_activity enable row level security;
-- owner sees the whole log; a side admin sees entries for their side + wedding-level entries
create policy stayact_read on app.stay_activity for select using (
  app.is_wedding_owner(wedding_id)
  or (household_id is not null and app.can_admin_household(wedding_id, household_id))
  or (guest_id     is not null and app.can_admin_guest(wedding_id, guest_id))
  or (household_id is null and guest_id is null and app.is_any_group_admin(wedding_id))
);

grant select on app.stay_activity to authenticated;      -- read-only; writes go through the definer function
revoke all on function app.log_stay_activity(uuid, app.stay_action, text, uuid, uuid) from public;
grant execute on function app.log_stay_activity(uuid, app.stay_action, text, uuid, uuid) to authenticated;
