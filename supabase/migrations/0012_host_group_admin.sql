-- 0012_host_group_admin.sql
-- Self-serve family (host_group) + family-admin management, so an organizer can stand up the two-family
-- model — and therefore use the finance module — without touching the SQL editor.
--
-- host_group / operator_role / wedding_membership are ALREADY owner-writable via their *_owner_all RLS
-- policies, and members can SELECT them. The two things RLS deliberately cannot do are:
--   (a) create or find an app.account for an admin's email — account has only self policies (deny-by-default
--       for anyone else's row), so the owner cannot mint an account for a family admin; and
--   (b) read another account's email back for display — again blocked by the account self policies.
-- Both go through owner-checked SECURITY DEFINER functions here (definer = table owner => bypasses RLS, and
-- each function re-checks app.is_wedding_owner for the caller). Applies cleanly on top of 0011.

-- ---------- create / rename / delete a host group (validated; owner-checked) ----------
create or replace function app.owner_create_host_group(p_wedding uuid, p_kind text, p_name text)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_id uuid;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'a family/group name is required'; end if;
  if p_kind is null or p_kind not in ('bride_family','groom_family','couple','mutual','custom') then
    raise exception 'invalid host group kind: %', p_kind; end if;
  insert into app.host_group (wedding_id, kind, name)
  values (p_wedding, p_kind::app.host_group_kind, trim(p_name))
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.owner_rename_host_group(p_wedding uuid, p_group uuid, p_name text)
returns void language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'a family/group name is required'; end if;
  update app.host_group set name = trim(p_name) where wedding_id = p_wedding and id = p_group;
  if not found then raise exception 'unknown host group'; end if;
end $$;

-- Delete only an EMPTY group (nothing depends on it) so we never silently orphan admins/expenses/households.
create or replace function app.owner_delete_host_group(p_wedding uuid, p_group uuid)
returns void language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if exists (select 1 from app.finance_expense            where wedding_id = p_wedding and paid_by_host_group_id     = p_group)
   or exists (select 1 from app.finance_expense_allocation where wedding_id = p_wedding and responsible_host_group_id = p_group)
   or exists (select 1 from app.household                  where wedding_id = p_wedding and host_group_id            = p_group)
   or exists (select 1 from app.operator_role             where wedding_id = p_wedding and host_group_id            = p_group) then
    raise exception 'this family still has admins, households, or expenses attached — remove those first';
  end if;
  delete from app.host_group where wedding_id = p_wedding and id = p_group;
  if not found then raise exception 'unknown host group'; end if;
end $$;

-- ---------- assign a family admin (or co-host) by email ----------
-- Resolve the email to an app.account (reuse an existing one, preferring an already-linked account; otherwise
-- create an UNLINKED account which 0009's link_signed_in_account adopts on that person's first verified
-- sign-in). Ensure an ACTIVE membership, then attach the role. Idempotent on operator_role's unique key.
-- Only host_group_admin / co_host may be assigned here — never wedding_owner.
create or replace function app.owner_assign_group_admin(p_wedding uuid, p_host_group uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_acc uuid; v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'a valid email is required'; end if;
  if p_role not in ('host_group_admin','co_host') then raise exception 'role must be host_group_admin or co_host'; end if;
  if not exists (select 1 from app.host_group where wedding_id = p_wedding and id = p_host_group) then
    raise exception 'unknown host group for this wedding'; end if;

  select id into v_acc from app.account
   where lower(email) = v_email
   order by (auth_user_id is not null) desc, created_at asc
   limit 1;
  if v_acc is null then
    insert into app.account (email) values (v_email) returning id into v_acc;
  end if;

  insert into app.wedding_membership (wedding_id, account_id, status)
  values (p_wedding, v_acc, 'active')
  on conflict (wedding_id, account_id) do update set status = 'active';

  insert into app.operator_role (wedding_id, account_id, role, host_group_id)
  values (p_wedding, v_acc, p_role::app.operator_role_kind, p_host_group)
  on conflict (wedding_id, account_id, role, host_group_id) do nothing;

  return v_acc;
end $$;

-- ---------- remove an operator-role assignment (never the wedding owner) ----------
create or replace function app.owner_remove_operator_role(p_wedding uuid, p_operator_role uuid)
returns void language plpgsql security definer set search_path = app, public as $$
declare v_role app.operator_role_kind;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  select role into v_role from app.operator_role where wedding_id = p_wedding and id = p_operator_role;
  if v_role is null then raise exception 'unknown assignment'; end if;
  if v_role = 'wedding_owner' then raise exception 'cannot remove the wedding owner here'; end if;
  delete from app.operator_role where wedding_id = p_wedding and id = p_operator_role;
end $$;

-- ---------- read: operators + their email, for the owner's management screen ----------
-- account.email is not readable cross-account under RLS, so expose it here, gated to the wedding owner.
create or replace function app.owner_list_operators(p_wedding uuid)
returns table(id uuid, account_id uuid, role text, host_group_id uuid, email text, linked boolean)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  return query
    select r.id, r.account_id, r.role::text, r.host_group_id, a.email, (a.auth_user_id is not null)
    from app.operator_role r
    join app.account a on a.id = r.account_id
    where r.wedding_id = p_wedding
    order by r.host_group_id nulls first, r.role, a.email;
end $$;

-- ---------- grants (least privilege) ----------
revoke execute on function app.owner_create_host_group(uuid, text, text)        from public, anon;
grant  execute on function app.owner_create_host_group(uuid, text, text)        to authenticated;
revoke execute on function app.owner_rename_host_group(uuid, uuid, text)        from public, anon;
grant  execute on function app.owner_rename_host_group(uuid, uuid, text)        to authenticated;
revoke execute on function app.owner_delete_host_group(uuid, uuid)              from public, anon;
grant  execute on function app.owner_delete_host_group(uuid, uuid)              to authenticated;
revoke execute on function app.owner_assign_group_admin(uuid, uuid, text, text) from public, anon;
grant  execute on function app.owner_assign_group_admin(uuid, uuid, text, text) to authenticated;
revoke execute on function app.owner_remove_operator_role(uuid, uuid)           from public, anon;
grant  execute on function app.owner_remove_operator_role(uuid, uuid)           to authenticated;
revoke execute on function app.owner_list_operators(uuid)                       from public, anon;
grant  execute on function app.owner_list_operators(uuid)                       to authenticated;
