-- 0004_invitation_rsvp.sql
-- Invitations authorize RSVP AT THE DATABASE LEVEL. event_attendance stores ONLY invitation_guest_id;
-- guest/instance are derived, so attendance for an uninvited (guest,instance) is structurally impossible.
-- RSVP mutates only via propose_rsvp_change -> confirm_rsvp_change (the shared web+bot command path).

create type app.invitation_status   as enum ('draft','sent','closed');
create type app.attendance_status   as enum ('accepted','declined','tentative');
create type app.rsvp_proposal_state as enum ('pending','confirmed','expired','superseded');
-- Two ORTHOGONAL provenance dimensions — never conflate them:
--   channel   = HOW the response arrived (transport); set by the trusted server path/context.
--   authority = on WHAT BASIS the actor acted for the guest; DERIVED from the relationship, never trusted.
create type app.rsvp_channel        as enum ('web','whatsapp','import');
create type app.rsvp_authority      as enum ('self','delegate','operator');

-- ---------- invitation (household -> one instance) ----------
create table app.invitation (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  household_id      uuid not null,
  event_instance_id uuid not null,
  plus_one_allowance integer not null default 0,
  rsvp_deadline_at  timestamptz,
  status            app.invitation_status not null default 'draft',
  created_at        timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  unique (wedding_id, id, event_instance_id),        -- lets invitation_guest pin the instance
  foreign key (wedding_id, household_id)      references app.household (wedding_id, id),
  foreign key (wedding_id, event_instance_id) references app.event_instance (wedding_id, id)
);

-- ---------- invitation_guest (the unit an RSVP attaches to) ----------
create table app.invitation_guest (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  invitation_id     uuid not null,
  event_instance_id uuid not null,        -- denormalized; constrained to match the invitation below
  guest_id          uuid not null,
  primary key (id),
  unique (wedding_id, id),
  unique (wedding_id, event_instance_id, guest_id),   -- no double-invite of a guest to one instance
  -- instance is guaranteed equal to the invitation's instance:
  foreign key (wedding_id, invitation_id, event_instance_id)
      references app.invitation (wedding_id, id, event_instance_id),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id)
);

-- explicit unnamed plus-ones (named later)
create table app.invitation_plus_one (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  invitation_id uuid not null,
  label         text,
  guest_id      uuid,                     -- filled once named
  primary key (id),
  foreign key (wedding_id, invitation_id) references app.invitation (wedding_id, id),
  foreign key (wedding_id, guest_id)      references app.guest (wedding_id, id)
);

-- ---------- attendance: ONE row per invitation_guest ----------
create table app.event_attendance (
  id                    uuid not null default gen_random_uuid(),
  wedding_id            uuid not null references app.wedding(id) on delete cascade,
  invitation_guest_id   uuid not null,
  status                app.attendance_status not null,
  responded_by_account_id uuid,
  responded_channel     app.rsvp_channel   not null default 'web',   -- transport (web/whatsapp/import)
  responded_as          app.rsvp_authority not null,                 -- basis (self/delegate/operator), derived
  responded_at          timestamptz not null default now(),
  row_version           integer not null default 1,     -- optimistic concurrency (guest vs proxy races)
  primary key (id),
  unique (wedding_id, id),                               -- composite-FK target (rsvp_change_log)
  unique (wedding_id, invitation_guest_id),              -- one attendance per invited (guest,instance)
  foreign key (wedding_id, invitation_guest_id) references app.invitation_guest (wedding_id, id)
);

-- derived view: attendance with its guest + instance (never stored on attendance).
-- security_invoker=true → the view runs with the QUERIER's RLS, not the owner's, so it cannot leak
-- another wedding's rows (a plain/definer view would bypass base-table RLS).
-- These aggregate/host views are OWNER-ONLY: a non-owner would otherwise get a misleading PARTIAL total
-- (only the rows they can read). security_invoker + an is_wedding_owner filter => full totals for the
-- owner, empty for everyone else, never cross-wedding.
create view app.attendance_expanded with (security_invoker = true) as
  select a.id, a.wedding_id, ig.event_instance_id, ig.guest_id,
         a.status, a.responded_by_account_id, a.responded_channel, a.responded_as, a.responded_at, a.row_version
  from app.event_attendance a
  join app.invitation_guest ig
    on ig.wedding_id = a.wedding_id and ig.id = a.invitation_guest_id
  where app.is_wedding_owner(a.wedding_id);

-- per-instance accepted counts (caterer report joins dietary in 0005)
create view app.instance_rsvp_counts with (security_invoker = true) as
  select ig.wedding_id, ig.event_instance_id,
         count(*) filter (where a.status = 'accepted')  as accepted,
         count(*) filter (where a.status = 'declined')  as declined,
         count(*) filter (where a.status = 'tentative') as tentative
  from app.invitation_guest ig
  left join app.event_attendance a
    on a.wedding_id = ig.wedding_id and a.invitation_guest_id = ig.id
  where app.is_wedding_owner(ig.wedding_id)
  group by ig.wedding_id, ig.event_instance_id;

-- ---------- proposals ----------
create table app.rsvp_proposal (
  id                  uuid not null default gen_random_uuid(),
  wedding_id          uuid not null references app.wedding(id) on delete cascade,
  invitation_guest_id uuid not null,
  proposed_status     app.attendance_status not null,
  channel             app.rsvp_channel   not null default 'web',   -- transport, from the trusted caller
  authority           app.rsvp_authority not null,                 -- derived basis (never client-supplied)
  proposed_by         uuid,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '30 minutes'),
  superseded_by       uuid,
  state               app.rsvp_proposal_state not null default 'pending',
  primary key (id),
  foreign key (wedding_id, invitation_guest_id) references app.invitation_guest (wedding_id, id)
);
-- AT MOST ONE pending proposal per invitation_guest (backstops the row lock in propose_rsvp_change)
create unique index rsvp_one_pending_per_ig
  on app.rsvp_proposal (wedding_id, invitation_guest_id) where state = 'pending';

create table app.rsvp_change_log (
  id                 uuid not null default gen_random_uuid(),
  wedding_id         uuid not null references app.wedding(id) on delete cascade,
  event_attendance_id uuid not null,
  from_status        app.attendance_status,
  to_status          app.attendance_status not null,
  actor_account_id   uuid,
  channel            app.rsvp_channel   not null,
  authority          app.rsvp_authority not null,
  at                 timestamptz not null default now(),
  foreign key (wedding_id, event_attendance_id) references app.event_attendance (wedding_id, id)
);

-- ---------- authorization helper for an invitation_guest ----------
create or replace function app.may_rsvp_invitation_guest(p_ig uuid) returns boolean
language plpgsql stable security definer set search_path = app, public as $$
declare v_wed uuid; v_guest uuid;
begin
  select wedding_id, guest_id into v_wed, v_guest from app.invitation_guest where id = p_ig;
  if v_wed is null then return false; end if;
  return app.can_act_for_guest(v_guest) or app.is_wedding_owner(v_wed);
end $$;

-- the invitation must be OPEN: sent (not draft/closed) and within its deadline
create or replace function app.invitation_open_for(p_ig uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.invitation_guest ig
    join app.invitation inv on inv.wedding_id = ig.wedding_id and inv.id = ig.invitation_id
    where ig.id = p_ig and inv.status = 'sent'
      and (inv.rsvp_deadline_at is null or now() <= inv.rsvp_deadline_at)
  );
$$;

-- ACTING AUTHORITY is DERIVED from the relationship, never trusted from the client. It answers "on what
-- basis may this account answer for the guest?" — distinct from the transport CHANNEL.
--   self     = the guest's own account            (guest.self_account_id = me)
--   delegate = an active, unexpired RSVP delegation to me for this guest
--   operator = wedding-operator authority (owner), acting WITHOUT a personal delegation
-- Mirrors the authorization in may_rsvp_invitation_guest (can_act_for_guest OR is_wedding_owner), so a
-- permitted actor always maps to exactly one basis; an unauthorized actor maps to NULL (propose/confirm
-- reject before this is used). This is what stops an owner being mislabeled a "proxy".
create or replace function app.derive_rsvp_authority(p_ig uuid) returns app.rsvp_authority
language plpgsql stable security definer set search_path = app, public as $$
declare v_wed uuid; v_guest uuid; v_acc uuid;
begin
  v_acc := app.current_account_id();
  if v_acc is null then return null; end if;
  select wedding_id, guest_id into v_wed, v_guest from app.invitation_guest where id = p_ig;
  if v_guest is null then return null; end if;
  if exists (select 1 from app.guest g where g.id = v_guest and g.self_account_id = v_acc) then
    return 'self';
  end if;
  if exists (select 1 from app.guest_delegation d
             where d.guest_id = v_guest and d.account_id = v_acc
               and d.revoked_at is null and (d.expires_at is null or d.expires_at > now())
               and 'rsvp' = any(d.capabilities)) then
    return 'delegate';
  end if;
  if app.is_wedding_owner(v_wed) then
    return 'operator';
  end if;
  return null;
end $$;

-- ---------- STEP 1: propose (no mutation to attendance) ----------
-- p_channel is the TRANSPORT, supplied by the trusted server path (the authenticated web wrapper hardcodes
-- 'web'; the WhatsApp/import service commands pass their own). The ACTING AUTHORITY is DERIVED here, never
-- a parameter, so no caller can forge who they are acting as.
create or replace function app.propose_rsvp_change(
  p_invitation_guest uuid, p_status app.attendance_status, p_channel app.rsvp_channel default 'web'
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v_wed uuid; v_proposal uuid; v_authority app.rsvp_authority;
begin
  select wedding_id into v_wed from app.invitation_guest where id = p_invitation_guest;
  if v_wed is null then raise exception 'unknown invitation_guest %', p_invitation_guest; end if;
  if not app.may_rsvp_invitation_guest(p_invitation_guest) then
    raise exception 'not authorized to RSVP for this guest';
  end if;
  if not app.invitation_open_for(p_invitation_guest) then
    raise exception 'invitation is closed, draft, or past its RSVP deadline';
  end if;

  v_authority := app.derive_rsvp_authority(p_invitation_guest);
  if v_authority is null then raise exception 'cannot determine RSVP authority'; end if;

  -- serialize concurrent proposers on this invitation_guest so exactly one pending proposal survives
  perform 1 from app.invitation_guest where id = p_invitation_guest for update;

  -- supersede any still-pending proposals for the same invitation_guest
  update app.rsvp_proposal
     set state = 'superseded'
   where invitation_guest_id = p_invitation_guest and state = 'pending';

  insert into app.rsvp_proposal (wedding_id, invitation_guest_id, proposed_status, channel, authority, proposed_by, state)
  values (v_wed, p_invitation_guest, p_status, p_channel, v_authority, app.current_account_id(), 'pending')
  returning id into v_proposal;
  return v_proposal;   -- caller echoes a confirmation; NOTHING has changed in attendance yet
end $$;

-- ---------- STEP 2: confirm (transactional attendance mutation) ----------
create or replace function app.confirm_rsvp_change(
  p_proposal uuid, p_expected_version integer default null
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_wed uuid; v_ig uuid; v_status app.attendance_status;
  v_channel app.rsvp_channel; v_authority app.rsvp_authority; v_proposed_by uuid;
  v_att uuid; v_from app.attendance_status; v_cur_version integer;
begin
  -- read the transport (channel) and the proposer, but NOT the stored authority — authority is re-derived
  -- for the confirmer below so it always describes the account that actually commits the attendance.
  select wedding_id, invitation_guest_id, proposed_status, channel, proposed_by
    into v_wed, v_ig, v_status, v_channel, v_proposed_by
    from app.rsvp_proposal
   where id = p_proposal and state = 'pending' and expires_at > now()
   for update;
  if v_wed is null then raise exception 'proposal % is not pending/valid', p_proposal; end if;

  -- CONFIRM MUST BE BY THE PROPOSING ACCOUNT. Otherwise account X could confirm account Y's pending
  -- proposal, and the attendance would record X as responder but Y's basis — cross-actor provenance.
  -- Requiring same-actor (and re-deriving authority just below) keeps responded_by_account_id and
  -- responded_as describing the same person.
  if app.current_account_id() is null or app.current_account_id() is distinct from v_proposed_by then
    raise exception 'this RSVP must be confirmed by the same account that proposed it';
  end if;

  if not app.may_rsvp_invitation_guest(v_ig) then
    raise exception 'not authorized to confirm this RSVP';
  end if;
  if not app.invitation_open_for(v_ig) then
    raise exception 'invitation is closed or past its RSVP deadline';
  end if;

  -- Re-derive authority for the CONFIRMER (== proposer) at commit time — reflects their basis *now*, so a
  -- delegation that lapsed during the 30-min window can't leave a stale 'delegate' on the record.
  v_authority := app.derive_rsvp_authority(v_ig);
  if v_authority is null then raise exception 'cannot determine RSVP authority'; end if;

  select id, status, row_version into v_att, v_from, v_cur_version
    from app.event_attendance where wedding_id = v_wed and invitation_guest_id = v_ig for update;

  if v_att is null then
    insert into app.event_attendance (wedding_id, invitation_guest_id, status, responded_by_account_id, responded_channel, responded_as)
    values (v_wed, v_ig, v_status, app.current_account_id(), v_channel, v_authority)
    returning id into v_att;
  else
    if p_expected_version is not null and p_expected_version <> v_cur_version then
      raise exception 'rsvp conflict: expected version % but current is %', p_expected_version, v_cur_version;
    end if;
    update app.event_attendance
       set status = v_status, responded_by_account_id = app.current_account_id(),
           responded_channel = v_channel, responded_as = v_authority, responded_at = now(),
           row_version = row_version + 1
     where id = v_att;
  end if;

  insert into app.rsvp_change_log (wedding_id, event_attendance_id, from_status, to_status, actor_account_id, channel, authority)
  values (v_wed, v_att, v_from, v_status, app.current_account_id(), v_channel, v_authority);

  -- promised audit trail (identifiers + structured provenance; no PII copied). channel/authority are
  -- STRUCTURED, typed columns (queryable/constrained/aggregatable) — the safe_summary is only a
  -- human-readable echo, never the source of truth for reports.
  insert into app.audit_event (wedding_id, actor_account_id, action, target_ref, channel, authority, safe_summary)
  values (v_wed, app.current_account_id(), 'rsvp', v_att::text, v_channel, v_authority,
          'rsvp ' || coalesce(v_from::text, 'none') || ' -> ' || v_status::text
            || ' (as ' || v_authority::text || ' via ' || v_channel::text || ')');

  update app.rsvp_proposal set state = 'confirmed' where id = p_proposal;
  return v_att;
end $$;

-- ---------- RLS ----------
alter table app.invitation          enable row level security;
alter table app.invitation_guest    enable row level security;
alter table app.invitation_plus_one enable row level security;
alter table app.event_attendance    enable row level security;
alter table app.rsvp_proposal       enable row level security;
alter table app.rsvp_change_log     enable row level security;

-- invitations are NOT member-wide: owner, or a guest (proxy) named on the invitation
create policy invitation_read on app.invitation for select using (
  app.is_wedding_owner(wedding_id)
  or exists (select 1 from app.invitation_guest ig
             where ig.wedding_id = invitation.wedding_id and ig.invitation_id = invitation.id
               and app.can_act_for_guest(ig.guest_id)));
create policy invitation_owner_write on app.invitation for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy ig_read on app.invitation_guest for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy ig_owner_write on app.invitation_guest for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy plus_one_owner_all on app.invitation_plus_one for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- attendance: a guest (or their proxy) may read their own; owner reads all. WRITES go only through the
-- SECURITY DEFINER functions (no write policy here → direct writes by app roles are denied).
create policy att_read_self on app.event_attendance for select
  using (app.is_wedding_owner(wedding_id)
         or exists (select 1 from app.invitation_guest ig
                    where ig.wedding_id = event_attendance.wedding_id
                      and ig.id = event_attendance.invitation_guest_id
                      and app.can_act_for_guest(ig.guest_id)));

create policy proposal_read on app.rsvp_proposal for select
  using (app.is_wedding_owner(wedding_id)
         or exists (select 1 from app.invitation_guest ig
                    where ig.wedding_id = rsvp_proposal.wedding_id
                      and ig.id = rsvp_proposal.invitation_guest_id
                      and app.can_act_for_guest(ig.guest_id)));
create policy changelog_owner_read on app.rsvp_change_log for select using (app.is_wedding_owner(wedding_id));
