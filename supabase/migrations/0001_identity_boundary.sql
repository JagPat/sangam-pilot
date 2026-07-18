-- 0001_identity_boundary.sql
-- Identity boundary: accounts (wedding-agnostic), memberships, host groups, operator roles.
-- Enforces the review's operator model + membership requirement + deny-by-default RLS.

create extension if not exists pgcrypto;
create schema if not exists app;

-- ---------- controlled value sets ----------
create type app.language          as enum ('en','hi','gu');
create type app.membership_status as enum ('invited','active','revoked');
create type app.operator_role_kind as enum ('wedding_owner','host_group_admin','co_host');
create type app.host_group_kind    as enum ('bride_family','groom_family','couple','mutual','custom');

-- ---------- account (NO wedding_id) ----------
create table app.account (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique references auth.users(id) on delete set null,
  phone          text,
  email          text,
  preferred_language app.language not null default 'en',
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- wedding (root) ----------
create table app.wedding (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  couple_names     text,
  default_timezone text not null default 'Asia/Kolkata',   -- IANA
  languages        app.language[] not null default '{en,hi,gu}',
  start_date       date,
  end_date         date,
  story            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- wedding_membership ----------
create table app.wedding_membership (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  account_id uuid not null references app.account(id) on delete cascade,
  status     app.membership_status not null default 'invited',
  created_at timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),               -- composite-FK target
  unique (wedding_id, account_id)        -- one membership per person per wedding (scoped uniqueness)
);

-- ---------- host_group ----------
create table app.host_group (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  kind       app.host_group_kind not null,
  name       text not null,
  primary key (id),
  unique (wedding_id, id)                -- composite-FK target
);

-- ---------- operator_role ----------
-- wedding_owner => host_group_id IS NULL; host_group_admin/co_host => host_group_id IS NOT NULL.
-- The (wedding_id, account_id) FK to membership guarantees the operator is a member of THIS wedding.
create table app.operator_role (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  account_id    uuid not null,
  role          app.operator_role_kind not null,
  host_group_id uuid,
  created_at    timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, account_id, role, host_group_id),
  foreign key (wedding_id, account_id) references app.wedding_membership (wedding_id, account_id) on delete cascade,
  foreign key (wedding_id, host_group_id) references app.host_group (wedding_id, id) on delete cascade,
  constraint operator_role_group_shape check (
    (role = 'wedding_owner'      and host_group_id is null) or
    (role in ('host_group_admin','co_host') and host_group_id is not null)
  )
);

-- Enforce that the referenced membership is ACTIVE (FK alone only proves it exists).
create or replace function app.enforce_active_membership() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from app.wedding_membership m
    where m.wedding_id = new.wedding_id and m.account_id = new.account_id and m.status = 'active'
  ) then
    raise exception 'account % is not an active member of wedding %', new.account_id, new.wedding_id;
  end if;
  return new;
end $$;

create trigger operator_role_active_member
  before insert or update on app.operator_role
  for each row execute function app.enforce_active_membership();

-- ---------- RLS helper functions ----------
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = app, public as $$
  select a.id from app.account a where a.auth_user_id = auth.uid();
$$;

create or replace function app.is_member(p_wedding uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.wedding_membership m
    where m.wedding_id = p_wedding and m.account_id = app.current_account_id() and m.status = 'active'
  );
$$;

-- NOTE: every operator check ALSO requires a currently-active membership, so revoking a person's
-- membership immediately strips their operator powers even if the operator_role row still exists.
create or replace function app.is_wedding_owner(p_wedding uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
    where r.wedding_id = p_wedding and r.account_id = app.current_account_id() and r.role = 'wedding_owner'
  );
$$;

create or replace function app.is_group_admin(p_wedding uuid, p_group uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
    where r.wedding_id = p_wedding and r.account_id = app.current_account_id()
      and r.role = 'host_group_admin' and r.host_group_id = p_group
  );
$$;

-- ---------- deny-by-default RLS ----------
alter table app.account            enable row level security;
alter table app.wedding            enable row level security;
alter table app.wedding_membership enable row level security;
alter table app.host_group         enable row level security;
alter table app.operator_role      enable row level security;

-- account: you can see/update only your own account row
create policy account_self_select on app.account for select using (auth_user_id = auth.uid());
create policy account_self_update on app.account for update using (auth_user_id = auth.uid());

-- wedding: members read; owner updates
create policy wedding_member_select on app.wedding for select using (app.is_member(id));
create policy wedding_owner_update  on app.wedding for update using (app.is_wedding_owner(id));

-- membership / host_group / operator_role: members read; owner writes
create policy membership_member_select on app.wedding_membership for select using (app.is_member(wedding_id));
create policy membership_owner_all     on app.wedding_membership for all    using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy host_group_member_select on app.host_group for select using (app.is_member(wedding_id));
create policy host_group_owner_all     on app.host_group for all    using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy operator_role_member_select on app.operator_role for select using (app.is_member(wedding_id));
create policy operator_role_owner_all     on app.operator_role for all    using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
