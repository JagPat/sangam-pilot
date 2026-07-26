-- Separate platform administration, wedding administration, event management, and private finance.
create type app.platform_role_kind as enum ('platform_super_admin');

create table app.platform_role (
  account_id uuid not null references app.account(id) on delete cascade,
  role app.platform_role_kind not null,
  created_at timestamptz not null default now(),
  primary key (account_id,role)
);
alter table app.platform_role enable row level security;

alter table app.operator_role drop constraint operator_role_group_shape;
alter table app.operator_role add constraint operator_role_group_shape check (
  (role::text in ('wedding_owner','event_manager','finance_admin') and host_group_id is null)
  or (role::text in ('host_group_admin','co_host') and host_group_id is not null)
);

-- NULLs are distinct in the original four-column unique constraint. Prevent duplicate
-- wedding-wide roles while preserving side-specific group roles.
create unique index operator_role_wedding_wide_unique
  on app.operator_role(wedding_id,account_id,role) where host_group_id is null;

create or replace function app.is_platform_super_admin() returns boolean
language sql stable security definer set search_path=app,public as $$
  select exists (
    select 1 from app.platform_role p
     where p.account_id=app.current_account_id() and p.role='platform_super_admin'
  );
$$;

create or replace function app.is_event_manager(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
     where r.wedding_id=p_wedding and r.account_id=app.current_account_id()
       and r.role::text='event_manager'
  );
$$;

create or replace function app.is_finance_admin(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
     where r.wedding_id=p_wedding and r.account_id=app.current_account_id()
       and r.role::text='finance_admin'
  );
$$;

revoke all on app.platform_role from public,anon,authenticated;
revoke execute on function app.is_platform_super_admin() from public,anon;
revoke execute on function app.is_event_manager(uuid) from public,anon;
revoke execute on function app.is_finance_admin(uuid) from public,anon;
grant execute on function app.is_platform_super_admin() to authenticated;
grant execute on function app.is_event_manager(uuid) to authenticated;
grant execute on function app.is_finance_admin(uuid) to authenticated;

-- Production bootstrap is resolved once from the trusted account record. Runtime checks use UUIDs.
insert into app.platform_role(account_id,role)
select id,'platform_super_admin' from app.account
 where lower(trim(email))='jagrutpatel@gmail.com'
on conflict do nothing;

-- The pilot account has been performing event-manager work under wedding_owner. Preserve that
-- operational capability explicitly without granting private-finance authority.
insert into app.operator_role(wedding_id,account_id,role,host_group_id)
select r.wedding_id,r.account_id,'event_manager',null
  from app.operator_role r join app.account a on a.id=r.account_id
 where r.role='wedding_owner' and lower(trim(a.email))='jagrutpatel@gmail.com'
on conflict do nothing;
