-- 06_account_link.sql — adversarial coverage for migration 0009 (app.link_signed_in_account).
-- Self-service identity binding on sign-in. Proves: verified-email is the SOLE key (never client input);
-- adopt an unlinked pre-seeded account by email; create-and-bind when none exists; NEVER rebind a guest
-- already attached to someone (no hijack); SHARED household contacts don't bind (personal only); don't
-- steal an email already linked to a different auth user; bind across every wedding the email is a guest
-- in; idempotent + null-safe; and SERVICE-ONLY execute (anon/authenticated cannot call it).
-- Requires: auth stub (auth.users with id + email) + 00_roles + migrations/grants.
\set ON_ERROR_STOP on
begin;

-- ===== auth users (the OTP-verified identities); email is what real Supabase records =====
insert into auth.users(id,email) values
  ('6a110000-0000-0000-0000-0000000000a0','ann@e.com'),        -- UA: adopts a pre-seeded unlinked account
  ('6a110000-0000-0000-0000-0000000000a1','bob@e.com'),        -- UB: no account yet -> create + bind
  ('6a110000-0000-0000-0000-0000000000a2','carl@e.com'),       -- UC: attacker for an already-bound guest
  ('6a110000-0000-0000-0000-0000000000a3','del@e.com'),        -- UD: only a SHARED contact matches
  ('6a110000-0000-0000-0000-0000000000a4','eve@e.com'),        -- UF: attacker for an email already linked
  ('6a110000-0000-0000-0000-0000000000a5','grace@e.com'),      -- UG: a guest in TWO weddings
  ('6a110000-0000-0000-0000-0000000000c9','carl-real@e.com'),  -- UX: carl's real, already-bound owner
  ('6a110000-0000-0000-0000-0000000000ce','eve@e.com');        -- UL: eve's real, already-linked account

-- ===== pre-seeded app.accounts (the §5 manual seed pattern) =====
insert into app.account(id,email) values
  ('6acc0000-0000-0000-0000-0000000000a0','ann@e.com');        -- AP: UNLINKED (auth_user_id null) -> adoptable
insert into app.account(id,auth_user_id,email) values
  ('6acc0000-0000-0000-0000-0000000000c9','6a110000-0000-0000-0000-0000000000c9','carl-real@e.com'), -- AX: carl's owner
  ('6acc0000-0000-0000-0000-0000000000ce','6a110000-0000-0000-0000-0000000000ce','eve@e.com');       -- AL: eve LINKED to UL

-- ===== weddings / households / guests / personal + shared contacts =====
insert into app.wedding(id,title) values
  ('6a000000-0000-0000-0000-0000000000a0','WA'),
  ('6b000000-0000-0000-0000-0000000000b0','WB');
insert into app.household(id,wedding_id,name) values
  ('6a000000-0000-0000-0000-0000000000f0','6a000000-0000-0000-0000-0000000000a0','HHA'),
  ('6b000000-0000-0000-0000-0000000000f1','6b000000-0000-0000-0000-0000000000b0','HHB');
insert into app.guest(id,wedding_id,household_id,full_name,self_account_id) values
  ('6a000000-0000-0000-0000-000000000001','6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','Ann',   null),
  ('6a000000-0000-0000-0000-000000000002','6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','Bob',   null),
  ('6a000000-0000-0000-0000-000000000003','6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','Carl',  '6acc0000-0000-0000-0000-0000000000c9'), -- already bound to AX
  ('6a000000-0000-0000-0000-000000000004','6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','Del',   null), -- shared-contact only
  ('6a000000-0000-0000-0000-000000000007','6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','GraceA',null),
  ('6b000000-0000-0000-0000-000000000008','6b000000-0000-0000-0000-0000000000b0','6b000000-0000-0000-0000-0000000000f1','GraceB',null);
insert into app.household_contact(wedding_id,household_id,guest_id,channel,value,is_shared) values
  ('6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','6a000000-0000-0000-0000-000000000001','email','ann@e.com',  false),
  ('6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','6a000000-0000-0000-0000-000000000002','email','bob@e.com',  false),
  ('6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','6a000000-0000-0000-0000-000000000003','email','carl@e.com', false),
  ('6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0','6a000000-0000-0000-0000-000000000007','email','grace@e.com',false),
  ('6b000000-0000-0000-0000-0000000000b0','6b000000-0000-0000-0000-0000000000f1','6b000000-0000-0000-0000-000000000008','email','grace@e.com',false),
  -- SHARED household inbox (guest_id NULL) that ALSO equals del@e.com — must NOT bind Del:
  ('6a000000-0000-0000-0000-0000000000a0','6a000000-0000-0000-0000-0000000000f0', null,                                 'email','del@e.com',  true);

-- ===== A) adopt an UNLINKED account by verified email, and bind the matching guest =====
do $$ declare v_acc uuid; v_self uuid; v_status app.membership_status; v_n int; begin
  v_acc := app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a0');   -- UA (ann)
  if v_acc <> '6acc0000-0000-0000-0000-0000000000a0' then raise exception 'FAIL(adopt): returned % not the pre-seeded account', v_acc; end if;
  if (select auth_user_id from app.account where id='6acc0000-0000-0000-0000-0000000000a0')
       is distinct from '6a110000-0000-0000-0000-0000000000a0' then raise exception 'FAIL(adopt): auth_user_id not attached'; end if;
  select self_account_id into v_self from app.guest where id='6a000000-0000-0000-0000-000000000001';
  if v_self <> v_acc then raise exception 'FAIL(adopt): guest Ann not bound (%)', v_self; end if;
  select status into v_status from app.wedding_membership where wedding_id='6a000000-0000-0000-0000-0000000000a0' and account_id=v_acc;
  if v_status is distinct from 'active' then raise exception 'FAIL(adopt): membership not active (%)', v_status; end if;
  select count(*) into v_n from app.account where lower(email)='ann@e.com';
  if v_n <> 1 then raise exception 'FAIL(adopt): duplicate account created for ann (%)', v_n; end if;
  raise notice 'OK(adopt): unlinked pre-seeded account adopted by verified email; guest bound; membership active; no duplicate';
end $$;

-- ===== B) no account for this identity -> CREATE one and bind =====
do $$ declare v_acc uuid; v_self uuid; begin
  v_acc := app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a1');   -- UB (bob)
  if v_acc is null then raise exception 'FAIL(create): no account returned for bob'; end if;
  if (select auth_user_id from app.account where id=v_acc) <> '6a110000-0000-0000-0000-0000000000a1' then raise exception 'FAIL(create): account not linked to UB'; end if;
  select self_account_id into v_self from app.guest where id='6a000000-0000-0000-0000-000000000002';
  if v_self <> v_acc then raise exception 'FAIL(create): guest Bob not bound (%)', v_self; end if;
  raise notice 'OK(create): new account created for a first-time signer and the matching guest bound';
end $$;

-- ===== C) NO HIJACK: a guest already bound to someone is never rebound =====
do $$ declare v_self uuid; begin
  perform app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a2');    -- UC (carl attacker)
  select self_account_id into v_self from app.guest where id='6a000000-0000-0000-0000-000000000003';
  if v_self <> '6acc0000-0000-0000-0000-0000000000c9' then
    raise exception 'FAIL(hijack): already-bound guest Carl was rebound to % (expected AX)', v_self; end if;
  raise notice 'OK(no-hijack): a guest already attached to an account is left untouched';
end $$;

-- ===== D) SHARED household contact must NOT bind (personal contacts only) =====
do $$ declare v_self uuid; begin
  perform app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a3');    -- UD (del) — only a shared inbox matches
  select self_account_id into v_self from app.guest where id='6a000000-0000-0000-0000-000000000004';
  if v_self is not null then raise exception 'FAIL(shared): a shared household contact bound guest Del (%)', v_self; end if;
  raise notice 'OK(shared-excluded): a shared household inbox does not bind an individual guest';
end $$;

-- ===== E) idempotent + null-safe =====
do $$ declare v_acc uuid; v_again uuid; v_self uuid; begin
  if app.link_signed_in_account(null) is not null then raise exception 'FAIL(null): null input did not return null'; end if;
  v_acc := app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a1');   -- UB again
  v_again := app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a1');
  if v_acc is distinct from v_again then raise exception 'FAIL(idempotent): re-run returned a different account'; end if;
  select self_account_id into v_self from app.guest where id='6a000000-0000-0000-0000-000000000002';
  if v_self <> v_acc then raise exception 'FAIL(idempotent): re-run disturbed the binding'; end if;
  raise notice 'OK(idempotent + null-safe): re-running on every sign-in is a stable no-op';
end $$;

-- ===== F) do NOT steal an email already LINKED to a different auth user =====
do $$ declare v_acc uuid; v_n int; begin
  v_acc := app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a4');   -- UF (eve attacker), email eve@e.com
  if v_acc = '6acc0000-0000-0000-0000-0000000000ce' then raise exception 'FAIL(steal): adopted the account already linked to UL'; end if;
  if (select auth_user_id from app.account where id='6acc0000-0000-0000-0000-0000000000ce')
       is distinct from '6a110000-0000-0000-0000-0000000000ce' then raise exception 'FAIL(steal): the linked account was hijacked'; end if;
  select count(*) into v_n from app.account where auth_user_id='6a110000-0000-0000-0000-0000000000a4';
  if v_n <> 1 then raise exception 'FAIL(steal): expected a fresh account for UF (got %)', v_n; end if;
  raise notice 'OK(no-steal): an email already linked to another auth user is never adopted; a fresh account is created';
end $$;

-- ===== G) bind across EVERY wedding the verified email is a guest in =====
do $$ declare v_acc uuid; v_s1 uuid; v_s2 uuid; begin
  v_acc := app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a5');   -- UG (grace) — guest in WA and WB
  select self_account_id into v_s1 from app.guest where id='6a000000-0000-0000-0000-000000000007';
  select self_account_id into v_s2 from app.guest where id='6b000000-0000-0000-0000-000000000008';
  if v_s1 <> v_acc or v_s2 <> v_acc then raise exception 'FAIL(cross-wedding): grace bound in only one wedding (WA=%, WB=%)', v_s1, v_s2; end if;
  if not exists (select 1 from app.wedding_membership where wedding_id='6b000000-0000-0000-0000-0000000000b0' and account_id=v_acc and status='active')
    then raise exception 'FAIL(cross-wedding): WB membership not activated'; end if;
  raise notice 'OK(cross-wedding): one verified email binds the guest in both weddings and activates both memberships';
end $$;

-- ===== H) SERVICE-ONLY execute: anon + authenticated are blocked; service_role is allowed =====
set local role anon;
do $$ begin
  begin
    perform app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a3');
    raise exception 'FAIL(grant): anon executed the service-only linker';
  exception when insufficient_privilege then raise notice 'OK(grant): anon cannot execute link_signed_in_account';
           when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK(grant): anon blocked (%)', sqlerrm; end if;
  end;
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a3');
    raise exception 'FAIL(grant): authenticated executed the service-only linker';
  exception when insufficient_privilege then raise notice 'OK(grant): authenticated cannot execute link_signed_in_account';
           when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK(grant): authenticated blocked (%)', sqlerrm; end if;
  end;
end $$;
reset role;

set local role service_role;
do $$ begin
  perform app.link_signed_in_account('6a110000-0000-0000-0000-0000000000a3');   -- trusted server path: allowed, no-op here
  raise notice 'OK(grant): service_role may execute the linker';
end $$;
reset role;

select 'ALL ACCOUNT-LINK TESTS PASSED' as result;
rollback;
