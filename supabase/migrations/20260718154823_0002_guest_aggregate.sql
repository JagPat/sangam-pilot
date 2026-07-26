-- 0002_guest_aggregate.sql
-- Households, guests, contacts, delegation (many-to-many, reminder routing), guardians,
-- directory consent, captain assignments, tags, import batches, and magic-link access tokens.

create type app.delegation_capability as enum ('rsvp','view_schedule','receive_reminders');

-- ---------- household ----------
create table app.household (
  id                 uuid not null default gen_random_uuid(),
  wedding_id         uuid not null references app.wedding(id) on delete cascade,
  name               text not null,
  host_group_id      uuid,
  primary_contact_id uuid,                       -- FK added after guest exists
  created_at         timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, host_group_id) references app.host_group (wedding_id, id)
);

-- ---------- guest ----------
create table app.guest (
  id                        uuid not null default gen_random_uuid(),
  wedding_id                uuid not null references app.wedding(id) on delete cascade,
  household_id              uuid not null,
  self_account_id           uuid references app.account(id) on delete set null,  -- the account that IS this guest
  full_name                 text not null,
  name_pronunciation_clip_url text,
  side_default              app.host_group_kind,
  origin_country            text,
  is_minor                  boolean not null default false,
  relationship_label        text,
  kinship_term              text,
  show_in_directory         boolean not null default true,
  created_at                timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, household_id) references app.household (wedding_id, id)
);

alter table app.household
  add constraint household_primary_contact_fk
  foreign key (wedding_id, primary_contact_id) references app.guest (wedding_id, id);

-- ---------- household_contact ----------
create table app.household_contact (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  household_id uuid not null,
  guest_id     uuid,
  channel      text not null,         -- 'whatsapp' | 'sms' | 'email'
  value        text not null,
  is_shared    boolean not null default false,
  primary key (id),
  foreign key (wedding_id, household_id) references app.household (wedding_id, id),
  foreign key (wedding_id, guest_id)     references app.guest (wedding_id, id)
);

-- ---------- guest_delegation (proxy) ----------
create table app.guest_delegation (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  guest_id     uuid not null,
  account_id   uuid not null,
  capabilities app.delegation_capability[] not null default '{rsvp,view_schedule}',
  granted_by   uuid,
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, guest_id)   references app.guest (wedding_id, id),
  foreign key (wedding_id, account_id) references app.wedding_membership (wedding_id, account_id)
);
create trigger delegation_active_member
  before insert or update on app.guest_delegation
  for each row execute function app.enforce_active_membership();

-- reminders route to the proxy WITHOUT overwriting the elder's own contact
create table app.delegation_notification_recipient (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  guest_id      uuid not null,
  recipient_account_id uuid not null,
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id),
  primary key (id)
);

-- ---------- guardian_assignment (minors) ----------
create table app.guardian_assignment (
  id                 uuid not null default gen_random_uuid(),
  wedding_id         uuid not null references app.wedding(id) on delete cascade,
  minor_guest_id     uuid not null,
  guardian_guest_id  uuid,
  guardian_account_id uuid,
  authority          text not null default 'full',
  granted_by         uuid,
  primary key (id),
  foreign key (wedding_id, minor_guest_id)    references app.guest (wedding_id, id),
  foreign key (wedding_id, guardian_guest_id) references app.guest (wedding_id, id),
  constraint guardian_exactly_one check (num_nonnulls(guardian_guest_id, guardian_account_id) = 1)
);

-- ---------- directory_consent (per field) ----------
create table app.directory_consent (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  guest_id     uuid not null,
  field        text not null,          -- 'name' | 'relationship' | 'photo' | 'bio'
  visible      boolean not null default false,
  consented_at timestamptz,
  primary key (id),
  unique (wedding_id, guest_id, field),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id)
);

-- ---------- captain_assignment ----------
create table app.captain_assignment (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  account_id   uuid not null,
  household_id uuid not null,
  primary key (id),
  unique (wedding_id, account_id, household_id),
  foreign key (wedding_id, account_id)   references app.wedding_membership (wedding_id, account_id),
  foreign key (wedding_id, household_id) references app.household (wedding_id, id)
);
create trigger captain_active_member
  before insert or update on app.captain_assignment
  for each row execute function app.enforce_active_membership();

-- ---------- tags/segments (Slice-1 [S1]) ----------
create table app.guest_tag (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  name       text not null,
  primary key (id),
  unique (wedding_id, id),
  unique (wedding_id, name)
);
create table app.guest_tag_assignment (
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  guest_id   uuid not null,
  tag_id     uuid not null,
  primary key (wedding_id, guest_id, tag_id),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id),
  foreign key (wedding_id, tag_id)   references app.guest_tag (wedding_id, id)
);

-- ---------- guest import (batch + rows + rollback) ----------
create table app.guest_import_batch (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  created_by uuid,
  status     text not null default 'pending',   -- pending|committed|rolled_back
  created_at timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id)
);
create table app.guest_import_row (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  batch_id          uuid not null,
  raw               jsonb not null,
  status            text not null default 'parsed',  -- parsed|error|applied
  error             text,
  resolved_guest_id uuid,
  primary key (id),
  foreign key (wedding_id, batch_id) references app.guest_import_batch (wedding_id, id),
  foreign key (wedding_id, resolved_guest_id) references app.guest (wedding_id, id)
);

-- ---------- guest_access_link (magic link; Sangam token only, no provider secrets) ----------
create table app.guest_access_link (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  guest_id   uuid not null,
  token_hash text not null unique,        -- store only sha256(token); the raw token is shown ONCE
  contact_hash text not null,             -- sha256(normalized intended contact) — RECIPIENT BINDING: the
                                          -- (OTP-)verified contact must match this to redeem or see the name
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  redeemed_by_account_id uuid,            -- which account consumed the token (exchange binding)
  primary key (id),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id)
);

-- ---------- helper: can this account act for this guest? ----------
-- Requires a currently-active membership in the guest's wedding for BOTH self and delegate paths, so a
-- revoked proxy (or a revoked guest) is immediately locked out even though the delegation row survives.
create or replace function app.can_act_for_guest(p_guest uuid) returns boolean
language plpgsql stable security definer set search_path = app, public as $$
declare v_wed uuid; v_acc uuid;
begin
  v_acc := app.current_account_id();
  if v_acc is null then return false; end if;
  select wedding_id into v_wed from app.guest where id = p_guest;
  if v_wed is null then return false; end if;
  if not app.is_member(v_wed) then return false; end if;           -- active membership required
  if exists (select 1 from app.guest g where g.id = p_guest and g.self_account_id = v_acc) then
    return true;                                                    -- self
  end if;
  return exists (                                                   -- active, unexpired delegation
    select 1 from app.guest_delegation d
    where d.guest_id = p_guest and d.account_id = v_acc
      and d.revoked_at is null and (d.expires_at is null or d.expires_at > now())
      and 'rsvp' = any(d.capabilities));
end $$;

-- helper: is the current account a captain for this household?
create or replace function app.is_captain_of_household(p_wedding uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.captain_assignment c
    where c.wedding_id = p_wedding and c.household_id = p_household and c.account_id = app.current_account_id()
  );
$$;

-- consent-respecting directory (safe columns only; contacts never exposed). Members only.
create view app.directory_entry as
  select g.wedding_id, g.id as guest_id, g.full_name, g.relationship_label, g.kinship_term,
         g.side_default, g.name_pronunciation_clip_url
  from app.guest g
  where g.show_in_directory
    and app.is_member(g.wedding_id)
    and coalesce((select dc.visible from app.directory_consent dc
                  where dc.wedding_id = g.wedding_id and dc.guest_id = g.id and dc.field = 'name'), true);

-- ---------- access links: hashed, atomic, single-use, RECIPIENT-BOUND ----------
-- p_contact is the contact the invite is being SENT to (email or E.164 phone). Only its hash is stored;
-- redemption/detail-viewing later requires the (OTP-)verified session contact to match. Normalization is
-- lower(trim(...)) — the caller must pass E.164 for phones so digits/`+` compare equal.
create or replace function app.issue_access_link(p_wedding uuid, p_guest uuid, p_contact text, p_ttl interval default interval '30 days')
returns text language plpgsql security definer set search_path = app, public as $$
declare v_raw text;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to issue links'; end if;
  if p_contact is null or length(trim(p_contact)) = 0 then
    raise exception 'an intended recipient contact is required to issue an invite link';
  end if;
  v_raw := encode(gen_random_bytes(32), 'hex');
  insert into app.guest_access_link(wedding_id, guest_id, token_hash, contact_hash, expires_at)
  values (p_wedding, p_guest, encode(digest(v_raw, 'sha256'), 'hex'),
          encode(digest(lower(trim(p_contact)), 'sha256'), 'hex'), now() + p_ttl);
  return v_raw;   -- shown to the guest ONCE; only the hash is persisted
end $$;

-- Atomic single-use: the UPDATE ... WHERE used_at IS NULL is the lock. Two concurrent redemptions of the
-- same token → exactly one updates the row and returns the guest; the other returns no rows.
-- bind the guest to an account. RAISES on a conflicting existing binding (never silently skips);
-- idempotent for the same account. SERVICE-ONLY.
create or replace function app.bind_guest_account(p_wedding uuid, p_guest uuid, p_account uuid)
returns void language plpgsql security definer set search_path = app, public as $$
declare v_existing uuid;
begin
  -- prove the guest exists (and lock it) BEFORE any side effect — otherwise a bad guest id would
  -- silently activate a membership and update zero guest rows.
  select self_account_id into v_existing from app.guest
    where wedding_id = p_wedding and id = p_guest for update;
  if not found then raise exception 'unknown guest % in wedding %', p_guest, p_wedding; end if;
  if v_existing is not null and v_existing <> p_account then
    raise exception 'guest % already bound to a different account', p_guest using errcode = '23505';
  end if;
  insert into app.wedding_membership(wedding_id, account_id, status)
  values (p_wedding, p_account, 'active')
  on conflict (wedding_id, account_id) do update set status = 'active';
  update app.guest set self_account_id = p_account where wedding_id = p_wedding and id = p_guest;
end $$;

-- Atomic, single-use, IDEMPOTENT, exchange-BOUND redemption: mark the link used AND bind it to the
-- redeeming account in one transaction. Replay by the SAME account is a no-op success; a different
-- account, an already-used token, or an expired token is rejected. SERVICE-ONLY.
create or replace function app.redeem_and_bind(p_raw text, p_account uuid, p_verified_contact text)
returns table(wedding_id uuid, guest_id uuid)
language plpgsql security definer set search_path = app, public as $$
declare v_link app.guest_access_link;
begin
  select * into v_link from app.guest_access_link
    where token_hash = encode(digest(p_raw, 'sha256'), 'hex') for update;
  if v_link.id is null then raise exception 'invalid link'; end if;

  -- RECIPIENT BINDING: the (OTP-)verified contact must match the contact the invite was issued to. A valid
  -- Supabase session for some OTHER account holding a forwarded link therefore CANNOT redeem — a session
  -- proves account ownership, this proves intended-recipient. Checked BEFORE any mutation, so a wrong
  -- contact never consumes the link.
  if v_link.contact_hash is distinct from encode(digest(lower(trim(coalesce(p_verified_contact,''))), 'sha256'), 'hex') then
    raise exception 'verified contact does not match the invitation';
  end if;

  if v_link.used_at is not null then
    if v_link.redeemed_by_account_id = p_account then
      perform app.bind_guest_account(v_link.wedding_id, v_link.guest_id, p_account); -- idempotent replay
      return query select v_link.wedding_id, v_link.guest_id; return;
    end if;
    raise exception 'link already used';
  end if;
  if v_link.expires_at <= now() then raise exception 'link expired'; end if;

  update app.guest_access_link set used_at = now(), redeemed_by_account_id = p_account where id = v_link.id;
  perform app.bind_guest_account(v_link.wedding_id, v_link.guest_id, p_account); -- raises on conflict
  return query select v_link.wedding_id, v_link.guest_id;
end $$;

-- READ-ONLY validation for the confirmation page: does NOT consume the token. SERVICE-ONLY.
-- READ-ONLY VALIDITY CHECK — returns NO PII. Safe to call for an UNAUTHENTICATED visitor: a link scanner,
-- a preview/unfurl bot, or someone a link was forwarded to sees only whether the link is live and (for
-- theming) which wedding — never the guest's name. Never mutates the link.
create or replace function app.peek_access_link(p_raw text)
returns table(wedding_id uuid, valid boolean)
language plpgsql stable security definer set search_path = app, public as $$
declare v_link app.guest_access_link;
begin
  select * into v_link from app.guest_access_link where token_hash = encode(digest(p_raw, 'sha256'), 'hex');
  if v_link.id is null then
    return query select null::uuid, false; return;
  end if;
  -- valid iff still fresh (not used, not expired). No guest lookup at all → no PII can escape here.
  return query select v_link.wedding_id, (v_link.used_at is null and v_link.expires_at > now());
end $$;

-- READ-ONLY, but RETURNS the guest name for the confirmation UI. The name is PII, so this MUST be called
-- only once a verified session exists (see app/app/invite/[token]/page.tsx, which calls it exclusively in
-- the signed-in branch). Still never mutates the link. Splitting it from peek_access_link makes the
-- "no name to the unauthenticated" property structural, not a caller convention.
create or replace function app.peek_invite_details(p_raw text, p_verified_contact text)
returns table(wedding_id uuid, guest_id uuid, guest_name text, valid boolean)
language plpgsql stable security definer set search_path = app, public as $$
declare v_link app.guest_access_link; v_name text;
begin
  select * into v_link from app.guest_access_link where token_hash = encode(digest(p_raw, 'sha256'), 'hex');
  if v_link.id is null then
    return query select null::uuid, null::uuid, null::text, false; return;
  end if;
  -- RECIPIENT BINDING: reveal the guest's name ONLY to the intended recipient (verified-contact match). A
  -- forwarded link opened by a different authenticated account gets valid=false and NO name.
  if v_link.contact_hash is distinct from encode(digest(lower(trim(coalesce(p_verified_contact,''))), 'sha256'), 'hex') then
    return query select v_link.wedding_id, v_link.guest_id, null::text, false; return;
  end if;
  if v_link.used_at is not null or v_link.expires_at <= now() then
    return query select v_link.wedding_id, v_link.guest_id, null::text, false; return;  -- valid=false, no mutation
  end if;
  -- alias the guest table: the RETURNS TABLE OUT columns (wedding_id/guest_id) would otherwise shadow the
  -- guest columns of the same name and make the predicate ambiguous.
  select g.full_name into v_name from app.guest g where g.wedding_id = v_link.wedding_id and g.id = v_link.guest_id;
  return query select v_link.wedding_id, v_link.guest_id, v_name, true;
end $$;

-- ---------- deny-by-default RLS + representative policies ----------
alter table app.household         enable row level security;
alter table app.guest             enable row level security;
alter table app.household_contact enable row level security;
alter table app.guest_delegation  enable row level security;
alter table app.delegation_notification_recipient enable row level security;
alter table app.guardian_assignment enable row level security;
alter table app.directory_consent enable row level security;
alter table app.captain_assignment enable row level security;
alter table app.guest_tag            enable row level security;
alter table app.guest_tag_assignment enable row level security;
alter table app.guest_import_batch   enable row level security;
alter table app.guest_import_row     enable row level security;
alter table app.guest_access_link    enable row level security;

-- guest base table is NOT member-wide: owner, or the guest/their proxy, or a captain of the household.
-- (The consent-respecting directory is exposed separately via app.directory_entry.)
create policy guest_read on app.guest for select using (
  app.is_wedding_owner(wedding_id)
  or app.can_act_for_guest(id)
  or app.is_captain_of_household(wedding_id, household_id)
);
create policy guest_owner_write on app.guest for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy household_read on app.household for select using (
  app.is_wedding_owner(wedding_id)
  or app.is_captain_of_household(wedding_id, id)
  or exists (select 1 from app.guest g where g.wedding_id = household.wedding_id and g.household_id = household.id and app.can_act_for_guest(g.id))
);
create policy household_owner_write on app.household for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- contacts are sensitive: owner or the household's own people; never member-wide
create policy contact_read on app.household_contact for select using (
  app.is_wedding_owner(wedding_id)
  or exists (select 1 from app.guest g where g.wedding_id = household_contact.wedding_id and g.household_id = household_contact.household_id and app.can_act_for_guest(g.id))
);
create policy contact_owner_write on app.household_contact for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- delegation: owner manages; a delegate may read their own delegations
create policy delegation_read on app.guest_delegation for select using (
  app.is_wedding_owner(wedding_id) or account_id = app.current_account_id());
create policy delegation_owner_write on app.guest_delegation for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- directory consent: the guest/proxy self-serves; owner may read/manage
create policy dconsent_read on app.directory_consent for select using (
  app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy dconsent_self_write on app.directory_consent for all
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id))
  with check (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));

-- guardians: owner manages; a guardian may read their own assignments
create policy guardian_read on app.guardian_assignment for select using (
  app.is_wedding_owner(wedding_id)
  or guardian_account_id = app.current_account_id()
  or app.can_act_for_guest(minor_guest_id));
create policy guardian_owner_write on app.guardian_assignment for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- tags are low-sensitivity labels: any active member may read; owner writes
create policy tag_read on app.guest_tag for select using (app.is_member(wedding_id));
create policy tag_owner_write on app.guest_tag for all using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy tagasg_read on app.guest_tag_assignment for select using (app.is_member(wedding_id));
create policy tagasg_owner_write on app.guest_tag_assignment for all using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- reminder-recipient routing, import batches/rows, and access links are OWNER/SERVICE only
create policy delegrecip_owner_all on app.delegation_notification_recipient for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy importbatch_owner_all on app.guest_import_batch for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy importrow_owner_all on app.guest_import_row for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy accesslink_owner_read on app.guest_access_link for select
  using (app.is_wedding_owner(wedding_id));  -- redemption happens via a service-role command, not user reads
