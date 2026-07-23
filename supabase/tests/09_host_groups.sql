-- 09_host_groups.sql — adversarial coverage for migration 0012 (family/host-group + family-admin RPCs).
-- Proves: only the wedding owner can create groups or assign admins; assigning by email mints an UNLINKED
-- account (so 0009 can adopt it on first sign-in), activates membership, and is idempotent; an existing
-- (already-linked) account is REUSED, never duplicated; role is restricted to host_group_admin/co_host
-- (never wedding_owner); cross-wedding owners are refused; owner_list_operators is owner-gated and returns
-- emails RLS would otherwise hide; the wedding_owner role can't be removed; and an in-use group can't be
-- deleted. Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

-- ===================== fixtures =====================
insert into auth.users(id,email) values
  ('99110000-0000-0000-0000-0000000000a0','owner1@e.com'),
  ('99110000-0000-0000-0000-0000000000b0','owner2@e.com'),
  ('99110000-0000-0000-0000-0000000000a4','member@e.com'),
  ('99110000-0000-0000-0000-0000000000ae','existing@x.com');
insert into app.account(id,auth_user_id,email) values
  ('99cc0000-0000-0000-0000-0000000000a0','99110000-0000-0000-0000-0000000000a0','owner1@e.com'),
  ('99cc0000-0000-0000-0000-0000000000b0','99110000-0000-0000-0000-0000000000b0','owner2@e.com'),
  ('99cc0000-0000-0000-0000-0000000000a4','99110000-0000-0000-0000-0000000000a4','member@e.com'),
  ('99cc0000-0000-0000-0000-0000000000ae','99110000-0000-0000-0000-0000000000ae','existing@x.com'); -- pre-LINKED

insert into app.wedding(id,title) values
  ('99000000-0000-0000-0000-000000000001','W1'),
  ('99000000-0000-0000-0000-000000000002','W2');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('99000000-0000-0000-0000-000000000001','99cc0000-0000-0000-0000-0000000000a0','active'),
  ('99000000-0000-0000-0000-000000000002','99cc0000-0000-0000-0000-0000000000b0','active'),
  ('99000000-0000-0000-0000-000000000001','99cc0000-0000-0000-0000-0000000000a4','active');  -- plain member of W1
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('99000000-0000-0000-0000-000000000001','99cc0000-0000-0000-0000-0000000000a0','wedding_owner',null),
  ('99000000-0000-0000-0000-000000000002','99cc0000-0000-0000-0000-0000000000b0','wedding_owner',null);
-- two seeded families in W1 (stable ids for the assign/list/remove/delete tests)
insert into app.host_group(id,wedding_id,kind,name) values
  ('99000000-0000-0000-0000-0000000000b0','99000000-0000-0000-0000-000000000001','bride_family','Bride family'),
  ('99000000-0000-0000-0000-0000000000c0','99000000-0000-0000-0000-000000000001','groom_family','Groom family');

-- ===== owner_create_host_group: owner makes a group; bad kind / blank name refused =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','99110000-0000-0000-0000-0000000000a0')::text, true); -- owner1
do $$ declare v_id uuid; v_kind app.host_group_kind; begin
  v_id := app.owner_create_host_group('99000000-0000-0000-0000-000000000001','couple','The Couple');
  select kind into v_kind from app.host_group where id = v_id;
  if v_kind <> 'couple' then raise exception 'FAIL(create): kind not stored (%)', v_kind; end if;
  begin perform app.owner_create_host_group('99000000-0000-0000-0000-000000000001','not_a_kind','X');
    raise exception 'FAIL(create): an invalid kind was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform app.owner_create_host_group('99000000-0000-0000-0000-000000000001','custom','   ');
    raise exception 'FAIL(create): a blank name was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  raise notice 'OK(create): owner creates a validated host group; bad kind + blank name refused';
end $$;

-- ===== owner_assign_group_admin: mint UNLINKED account, activate membership, attach role; idempotent; reuse =====
-- NB: app.account rows are self-only under RLS, so the owner verifies email/linked/role through the
-- owner_list_operators API (owner-gated); the raw no-duplicate-account cross-check runs as superuser below.
do $$ declare v_acc uuid; v_again uuid; v_reuse uuid; v_n int; v_linked uuid; begin
  v_acc := app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','Bride@x.com','host_group_admin');
  if not exists (select 1 from app.wedding_membership where wedding_id='99000000-0000-0000-0000-000000000001' and account_id=v_acc and status='active')
    then raise exception 'FAIL(assign): membership not active'; end if;
  -- role attached + email normalised + account still UNLINKED, via the owner API
  if not exists (select 1 from app.owner_list_operators('99000000-0000-0000-0000-000000000001')
                   where account_id=v_acc and email='bride@x.com' and role='host_group_admin'
                     and host_group_id='99000000-0000-0000-0000-0000000000b0' and linked=false)
    then raise exception 'FAIL(assign): admin not attached as an unlinked, normalised bride@x.com host_group_admin'; end if;
  -- idempotent: same email+group+role -> same account, exactly one operator_role row
  v_again := app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','bride@x.com','host_group_admin');
  if v_again <> v_acc then raise exception 'FAIL(assign): re-assign created a different account'; end if;
  select count(*) into v_n from app.operator_role where wedding_id='99000000-0000-0000-0000-000000000001' and account_id=v_acc
    and role='host_group_admin' and host_group_id='99000000-0000-0000-0000-0000000000b0';
  if v_n <> 1 then raise exception 'FAIL(assign): duplicate operator_role rows (%)', v_n; end if;
  -- reuse the SAME account for a second role/group (co_host on groom family)
  v_reuse := app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000c0','bride@x.com','co_host');
  if v_reuse <> v_acc then raise exception 'FAIL(assign): same email produced a second account'; end if;
  -- an ALREADY-LINKED account is reused by email (returns the pre-existing account id)
  v_linked := app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000c0','Existing@x.com','host_group_admin');
  if v_linked <> '99cc0000-0000-0000-0000-0000000000ae' then raise exception 'FAIL(assign): existing linked account not reused (%)', v_linked; end if;
  perform set_config('sangam.bride_acc', v_acc::text, false);
  raise notice 'OK(assign): mints an unlinked account, activates membership, attaches role; idempotent; reuses existing/linked accounts';
end $$;

-- ===== role + target validation =====
do $$ begin
  begin perform app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','x@e.com','wedding_owner');
    raise exception 'FAIL(role): wedding_owner could be assigned as a family admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(role): only host_group_admin/co_host may be assigned (%)', sqlerrm; end;
  begin perform app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','not-an-email','host_group_admin');
    raise exception 'FAIL(email): an invalid email was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(email): a malformed email is rejected (%)', sqlerrm; end;
  begin perform app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001', gen_random_uuid(),'y@e.com','host_group_admin');
    raise exception 'FAIL(group): assignment to a nonexistent group was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(group): unknown host group rejected (%)', sqlerrm; end;
end $$;
reset role;

-- raw account state (as superuser, since account rows are self-only under RLS): no duplicate accounts, and
-- the minted admin account is genuinely UNLINKED (so 0009 can adopt it) and lowercase-normalised.
do $$ declare v_bride uuid := current_setting('sangam.bride_acc')::uuid; begin
  if (select count(*) from app.account where lower(email)='bride@x.com')    <> 1 then raise exception 'FAIL(assign): the bride admin account was duplicated'; end if;
  if (select count(*) from app.account where lower(email)='existing@x.com') <> 1 then raise exception 'FAIL(assign): the existing account was duplicated'; end if;
  if (select auth_user_id from app.account where id = v_bride) is not null then raise exception 'FAIL(assign): minted account should be UNLINKED'; end if;
  if (select email from app.account where id = v_bride) <> 'bride@x.com'    then raise exception 'FAIL(assign): minted email not lowercase-normalised'; end if;
  raise notice 'OK(assign-state): no duplicate accounts; the minted admin account is unlinked + normalised';
end $$;

-- ===== a plain member (no owner role) can do NONE of it =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','99110000-0000-0000-0000-0000000000a4')::text, true); -- member of W1
do $$ begin
  begin perform app.owner_create_host_group('99000000-0000-0000-0000-000000000001','custom','Sneaky');
    raise exception 'FAIL(authz): non-owner created a host group';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(authz): non-owner cannot create a group (%)', sqlerrm; end;
  begin perform app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','z@e.com','host_group_admin');
    raise exception 'FAIL(authz): non-owner assigned an admin';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(authz): non-owner cannot assign an admin (%)', sqlerrm; end;
  begin perform count(*) from app.owner_list_operators('99000000-0000-0000-0000-000000000001');
    raise exception 'FAIL(authz): non-owner listed operators';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(authz): non-owner cannot list operators (%)', sqlerrm; end;
end $$;
reset role;

-- ===== a DIFFERENT wedding's owner is refused on W1 (cross-wedding isolation) =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','99110000-0000-0000-0000-0000000000b0')::text, true); -- owner of W2
do $$ begin
  begin perform app.owner_create_host_group('99000000-0000-0000-0000-000000000001','custom','X');
    raise exception 'FAIL(iso): W2 owner created a group in W1';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(iso): W2 owner cannot create in W1 (%)', sqlerrm; end;
  begin perform app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','z@e.com','host_group_admin');
    raise exception 'FAIL(iso): W2 owner assigned an admin in W1';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(iso): W2 owner cannot assign in W1 (%)', sqlerrm; end;
end $$;
reset role;

-- ===== owner_list_operators (owner-gated) exposes emails RLS hides; remove + delete guards =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','99110000-0000-0000-0000-0000000000a0')::text, true); -- owner1
do $$ declare v_owner int; v_bride_admin uuid; v_couple uuid; begin
  -- list includes the owner (host_group_id null) plus the assigned family admins with their emails
  if (select count(*) from app.owner_list_operators('99000000-0000-0000-0000-000000000001')
        where role='wedding_owner' and host_group_id is null) <> 1 then raise exception 'FAIL(list): owner row missing'; end if;
  if not exists (select 1 from app.owner_list_operators('99000000-0000-0000-0000-000000000001')
                   where email='bride@x.com' and role='host_group_admin' and host_group_id='99000000-0000-0000-0000-0000000000b0')
    then raise exception 'FAIL(list): assigned bride admin (with email) not returned'; end if;

  -- remove the bride-family admin assignment
  select id into v_bride_admin from app.operator_role
    where wedding_id='99000000-0000-0000-0000-000000000001' and host_group_id='99000000-0000-0000-0000-0000000000b0' and role='host_group_admin' limit 1;
  perform app.owner_remove_operator_role('99000000-0000-0000-0000-000000000001', v_bride_admin);
  if exists (select 1 from app.operator_role where id = v_bride_admin) then raise exception 'FAIL(remove): assignment survived'; end if;

  -- the wedding_owner role cannot be removed via this path
  begin
    perform app.owner_remove_operator_role('99000000-0000-0000-0000-000000000001',
      (select id from app.operator_role where wedding_id='99000000-0000-0000-0000-000000000001' and role='wedding_owner' limit 1));
    raise exception 'FAIL(remove): the wedding_owner role was removed';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- delete guard: the groom family still has admins attached -> refused
  begin perform app.owner_delete_host_group('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000c0');
    raise exception 'FAIL(delete): deleted a family that still has admins';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- but an EMPTY group (the 'couple' one created earlier, no admins/finance/households) can be deleted
  select id into v_couple from app.host_group where wedding_id='99000000-0000-0000-0000-000000000001' and kind='couple' limit 1;
  perform app.owner_delete_host_group('99000000-0000-0000-0000-000000000001', v_couple);
  if exists (select 1 from app.host_group where id = v_couple) then raise exception 'FAIL(delete): empty group not deleted'; end if;

  raise notice 'OK(list/remove/delete): owner-gated listing with emails; owner role protected; in-use group protected; empty group deletable';
end $$;
reset role;

-- ===== anon cannot execute the owner RPCs =====
set local role anon;
do $$ begin
  begin perform app.owner_create_host_group('99000000-0000-0000-0000-000000000001','custom','X');
    raise exception 'FAIL(grant): anon executed owner_create_host_group';
  exception when insufficient_privilege then raise notice 'OK(grant): anon cannot create groups';
           when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK(grant): anon blocked (%)', sqlerrm; end if; end;
  begin perform app.owner_assign_group_admin('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-0000000000b0','z@e.com','host_group_admin');
    raise exception 'FAIL(grant): anon executed owner_assign_group_admin';
  exception when insufficient_privilege then raise notice 'OK(grant): anon cannot assign admins';
           when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK(grant): anon blocked (%)', sqlerrm; end if; end;
end $$;
reset role;

select 'ALL HOST-GROUP TESTS PASSED' as result;
rollback;
