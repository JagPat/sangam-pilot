-- 04_rls_adversarial.sql — extended adversarial coverage (runs AS authenticated / anon).
-- Regressions for: aggregate-view cross-wedding leak; PUBLIC execute of SECURITY DEFINER funcs;
-- unrelated/anon actors; cross-wedding reads; closed/expired RSVP; direct attendance writes;
-- expired delegation. Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

-- ===== seed two weddings A and B =====
insert into auth.users(id) values
  ('aaaa1111-0000-0000-0000-00000000a010'),('aaaa1111-0000-0000-0000-00000000a020'),
  ('aaaa1111-0000-0000-0000-00000000a030'),('aaaa1111-0000-0000-0000-00000000a040'),
  ('bbbb2222-0000-0000-0000-00000000b010') on conflict do nothing;

insert into app.wedding(id,title) values
  ('55555555-0000-0000-0000-00000000aa01','A'),('55555555-0000-0000-0000-00000000bb01','B');
insert into app.account(id,auth_user_id) values
  ('55555555-0000-0000-0000-00000000a010','aaaa1111-0000-0000-0000-00000000a010'),
  ('55555555-0000-0000-0000-00000000a020','aaaa1111-0000-0000-0000-00000000a020'),
  ('55555555-0000-0000-0000-00000000a030','aaaa1111-0000-0000-0000-00000000a030'),
  ('55555555-0000-0000-0000-00000000a040','aaaa1111-0000-0000-0000-00000000a040'),
  ('55555555-0000-0000-0000-00000000b010','bbbb2222-0000-0000-0000-00000000b010');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a010','active'),
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a020','active'),
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a030','active'),
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a040','active'),
  ('55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b010','active');
insert into app.operator_role(wedding_id,account_id,role) values
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a010','wedding_owner'),
  ('55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b010','wedding_owner');

-- A
insert into app.household(id,wedding_id,name) values ('55555555-0000-0000-0000-00000000a011','55555555-0000-0000-0000-00000000aa01','HA');
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('55555555-0000-0000-0000-00000000a021','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a011','GA'),
  ('55555555-0000-0000-0000-00000000a022','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a011','GA2'); -- 2nd guest: peek/redeem test
insert into app.guest_delegation(wedding_id,guest_id,account_id,capabilities) values
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a021','55555555-0000-0000-0000-00000000a030','{rsvp}');            -- active proxy
insert into app.guest_delegation(wedding_id,guest_id,account_id,capabilities,expires_at) values
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a021','55555555-0000-0000-0000-00000000a040','{rsvp}', now() - interval '1 day'); -- EXPIRED proxy
insert into app.event_function(id,wedding_id,name,type) values ('55555555-0000-0000-0000-00000000a031','55555555-0000-0000-0000-00000000aa01','F','sangeet');
insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival) values
  ('55555555-0000-0000-0000-00000000a041','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a031','Asia/Kolkata',row(now(),now()::timestamp,330,'h')::app.zoned_time),
  ('55555555-0000-0000-0000-00000000a042','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a031','Asia/Kolkata',row(now(),now()::timestamp,330,'h')::app.zoned_time);
insert into app.invitation(id,wedding_id,household_id,event_instance_id,status) values
  ('55555555-0000-0000-0000-00000000a051','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a011','55555555-0000-0000-0000-00000000a041','sent'),
  ('55555555-0000-0000-0000-00000000a052','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a011','55555555-0000-0000-0000-00000000a042','closed');
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('55555555-0000-0000-0000-00000000a061','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a051','55555555-0000-0000-0000-00000000a041','55555555-0000-0000-0000-00000000a021'),
  ('55555555-0000-0000-0000-00000000a062','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a052','55555555-0000-0000-0000-00000000a042','55555555-0000-0000-0000-00000000a021');
-- expired-deadline invitation (status 'sent' but rsvp_deadline_at in the past)
insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival) values
  ('55555555-0000-0000-0000-00000000a043','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a031','Asia/Kolkata',row(now(),now()::timestamp,330,'h')::app.zoned_time);
insert into app.invitation(id,wedding_id,household_id,event_instance_id,status,rsvp_deadline_at) values
  ('55555555-0000-0000-0000-00000000a053','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a011','55555555-0000-0000-0000-00000000a043','sent', now() - interval '1 day');
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('55555555-0000-0000-0000-00000000a063','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a053','55555555-0000-0000-0000-00000000a043','55555555-0000-0000-0000-00000000a021');
-- B
insert into app.household(id,wedding_id,name) values ('55555555-0000-0000-0000-00000000b011','55555555-0000-0000-0000-00000000bb01','HB');
insert into app.guest(id,wedding_id,household_id,full_name) values ('55555555-0000-0000-0000-00000000b021','55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b011','GB');
insert into app.event_function(id,wedding_id,name,type) values ('55555555-0000-0000-0000-00000000b031','55555555-0000-0000-0000-00000000bb01','F','sangeet');
insert into app.event_instance(id,wedding_id,event_function_id,iana_timezone,arrival) values
  ('55555555-0000-0000-0000-00000000b041','55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b031','America/New_York',row(now(),now()::timestamp,-300,'h')::app.zoned_time);
insert into app.invitation(id,wedding_id,household_id,event_instance_id,status) values
  ('55555555-0000-0000-0000-00000000b051','55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b011','55555555-0000-0000-0000-00000000b041','sent');
insert into app.invitation_guest(id,wedding_id,invitation_id,event_instance_id,guest_id) values
  ('55555555-0000-0000-0000-00000000b061','55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b051','55555555-0000-0000-0000-00000000b041','55555555-0000-0000-0000-00000000b021');

-- seed one accepted attendance in EACH wedding (direct insert as superuser)
insert into app.event_attendance(wedding_id,invitation_guest_id,status,responded_as) values
  ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a061','accepted','self'),
  ('55555555-0000-0000-0000-00000000bb01','55555555-0000-0000-0000-00000000b061','accepted','self');

-- ===== P0: aggregate views must NOT leak across weddings =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a010')::text, true); -- A owner
do $$ declare n int; begin
  select count(*) into n from app.instance_rsvp_counts where event_instance_id='55555555-0000-0000-0000-00000000b041';
  if n <> 0 then raise exception 'FAIL(view-leak): A owner saw B counts via instance_rsvp_counts (%)', n; end if;
  select count(*) into n from app.attendance_expanded where wedding_id='55555555-0000-0000-0000-00000000bb01';
  if n <> 0 then raise exception 'FAIL(view-leak): A owner saw B rows via attendance_expanded'; end if;
  select count(*) into n from app.caterer_report where event_instance_id='55555555-0000-0000-0000-00000000b041';
  if n <> 0 then raise exception 'FAIL(view-leak): A owner saw B rows via caterer_report'; end if;
  select count(*) into n from app.instance_rsvp_counts where event_instance_id='55555555-0000-0000-0000-00000000a041' and accepted=1;
  if n <> 1 then raise exception 'FAIL: A owner cannot see own counts (%)', n; end if;
  raise notice 'OK(view-leak): aggregate views are wedding-scoped (A owner sees A, never B)';
end $$;
reset role;

-- ===== cross-wedding base read: A member cannot read a B instance =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a020')::text, true); -- A member
do $$ declare n int; begin
  select count(*) into n from app.event_instance where id='55555555-0000-0000-0000-00000000b041';
  if n <> 0 then raise exception 'FAIL: A member read a B event_instance'; end if;
  -- owner-only aggregate views: a NON-owner member must get an EMPTY result, never a partial total
  select count(*) into n from app.instance_rsvp_counts where wedding_id='55555555-0000-0000-0000-00000000aa01';
  if n <> 0 then raise exception 'FAIL: non-owner saw owner-only instance_rsvp_counts (%)', n; end if;
  select count(*) into n from app.caterer_report where wedding_id='55555555-0000-0000-0000-00000000aa01';
  if n <> 0 then raise exception 'FAIL: non-owner saw owner-only caterer_report'; end if;
  raise notice 'OK: A member cannot read a B instance; aggregate views empty for non-owner';
end $$;
-- unrelated authenticated cannot propose for a guest they cannot act for
do $$ begin
  begin
    perform public.propose_rsvp_change('55555555-0000-0000-0000-00000000a061'::uuid,'accepted'::app.attendance_status);
    raise exception 'FAIL: unrelated member proposed for a guest they cannot act for';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: unrelated authenticated blocked from proposing (%)', sqlerrm;
  end;
end $$;
-- direct attendance write must be denied (no INSERT grant / no write policy)
do $$ begin
  begin
    insert into app.event_attendance(wedding_id,invitation_guest_id,status)
      values ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a061','declined');
    raise exception 'FAIL: authenticated wrote attendance directly';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: direct attendance write denied (%)', sqlerrm;
  end;
end $$;
reset role;

-- ===== anon cannot EXECUTE SECURITY DEFINER functions (PUBLIC execute revoked) =====
set local role anon;
do $$ begin
  begin
    perform app.is_member('55555555-0000-0000-0000-00000000aa01'::uuid);
    raise exception 'FAIL: anon executed a SECURITY DEFINER function';
  exception
    when insufficient_privilege then raise notice 'OK: anon cannot execute app.* (%)', sqlerrm;
    when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK: anon blocked (%)', sqlerrm; end if;
  end;
end $$;
reset role;

-- ===== closed / expired-delegation RSVP attempts =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a030')::text, true); -- active proxy
do $$ begin
  begin
    perform public.propose_rsvp_change('55555555-0000-0000-0000-00000000a062'::uuid,'accepted'::app.attendance_status); -- CLOSED invitation
    raise exception 'FAIL: RSVP accepted against a closed invitation';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: closed-invitation RSVP rejected (%)', sqlerrm;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a040')::text, true); -- EXPIRED proxy
do $$ begin
  begin
    perform public.propose_rsvp_change('55555555-0000-0000-0000-00000000a061'::uuid,'accepted'::app.attendance_status);
    raise exception 'FAIL: expired-delegation proxy proposed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: expired-delegation proxy blocked (%)', sqlerrm;
  end;
end $$;
reset role;

-- ===== expired rsvp_deadline (status 'sent' but deadline passed) must be rejected =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a030')::text, true); -- active proxy
do $$ begin
  begin
    perform public.propose_rsvp_change('55555555-0000-0000-0000-00000000a063'::uuid,'accepted'::app.attendance_status);
    raise exception 'FAIL: RSVP accepted past the deadline';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: past-deadline RSVP rejected (%)', sqlerrm;
  end;
end $$;
reset role;

-- ===== host CAN write (DML grant + owner_write RLS) =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a010')::text, true); -- A owner
do $$ begin
  insert into app.guest(id,wedding_id,household_id,full_name)
    values ('55555555-0000-0000-0000-0000000000c9','55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a011','New Guest');
  if not exists (select 1 from app.guest where id='55555555-0000-0000-0000-0000000000c9') then
    raise exception 'FAIL: host could not create a guest';
  end if;
  raise notice 'OK: host can write (created a guest under owner_write RLS + DML grant)';
end $$;
reset role;

-- ===== redeem_and_bind: RECIPIENT-BOUND + single-use + idempotent-by-account + conflict reject =====
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a010')::text, true); -- owner context for issue
do $$
declare v_raw text; v_g uuid; v_valid boolean;
begin
  v_raw := app.issue_access_link('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a021','guest-a021@example.com');
  -- a WRONG verified contact (a forwarded link opened by another account) must be rejected WITHOUT consuming
  begin
    perform app.redeem_and_bind(v_raw, '55555555-0000-0000-0000-00000000a020', 'attacker@example.com');
    raise exception 'FAIL: redeemed with a non-matching verified contact';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select valid into v_valid from app.peek_access_link(v_raw);
  if not v_valid then raise exception 'FAIL: a wrong-contact attempt consumed the link'; end if;
  -- correct contact (case-insensitive) → first use binds to a020
  select guest_id into v_g from app.redeem_and_bind(v_raw, '55555555-0000-0000-0000-00000000a020', 'GUEST-A021@example.com');
  if v_g <> '55555555-0000-0000-0000-00000000a021' then raise exception 'FAIL: redeem_and_bind wrong guest'; end if;
  perform app.redeem_and_bind(v_raw, '55555555-0000-0000-0000-00000000a020', 'guest-a021@example.com');   -- replay same account = ok
  begin
    perform app.redeem_and_bind(v_raw, '55555555-0000-0000-0000-00000000a030', 'guest-a021@example.com'); -- different account = reject
    raise exception 'FAIL: used link redeemed by a different account';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'OK: redeem is recipient-bound (wrong contact rejected + not consumed), single-use, idempotent-by-account, conflict-rejecting';
end $$;

-- ===== peek validates a token WITHOUT consuming it (GET confirmation path) =====
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a010')::text, true); -- owner issues
do $$
declare v_raw text; v_valid boolean; v_name text;
begin
  v_raw := app.issue_access_link('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a022','guest-a022@example.com');
  -- unauthenticated-safe validity check: peek_access_link has NO guest-name column, so a scanner/unfurler/
  -- forwarded-link holder cannot read PII here.
  select valid into v_valid from app.peek_access_link(v_raw);
  if not v_valid then raise exception 'FAIL: peek marks a fresh link invalid'; end if;
  -- details with a WRONG contact must NOT reveal the name (recipient binding on the detail path too).
  select guest_name into v_name from app.peek_invite_details(v_raw, 'attacker@example.com');
  if v_name is not null then raise exception 'FAIL: peek_invite_details leaked the name to a non-recipient'; end if;
  -- details with the MATCHING contact returns the name.
  select guest_name into v_name from app.peek_invite_details(v_raw, 'guest-a022@example.com');
  if v_name is null then raise exception 'FAIL: peek_invite_details did not return the name to the recipient'; end if;
  select valid into v_valid from app.peek_access_link(v_raw);       -- peek again: must still be valid
  if not v_valid then raise exception 'FAIL: peek consumed the token'; end if;
  perform app.redeem_and_bind(v_raw, '55555555-0000-0000-0000-00000000a040', 'guest-a022@example.com');  -- now consume
  select valid into v_valid from app.peek_access_link(v_raw);       -- and only now invalid
  if v_valid then raise exception 'FAIL: peek still valid after redemption'; end if;
  raise notice 'OK: peek no-PII + non-consuming; details recipient-bound (name only on contact match); invalid after redeem';
end $$;

-- ===== bind rejects a nonexistent guest (no silent membership activation) =====
do $$ begin
  begin
    perform app.bind_guest_account('55555555-0000-0000-0000-00000000aa01'::uuid, gen_random_uuid(), '55555555-0000-0000-0000-00000000a020'::uuid);
    raise exception 'FAIL: bind_guest_account accepted a nonexistent guest';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: bind rejects unknown guest (%)', sqlerrm;
  end;
end $$;

-- ===== at most one PENDING proposal per invitation_guest (partial unique index) =====
do $$ begin
  insert into app.rsvp_proposal(wedding_id, invitation_guest_id, proposed_status, channel, authority, state)
    values ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a061','accepted','web','self','pending');
  begin
    insert into app.rsvp_proposal(wedding_id, invitation_guest_id, proposed_status, channel, authority, state)
      values ('55555555-0000-0000-0000-00000000aa01','55555555-0000-0000-0000-00000000a061','declined','web','self','pending');
    raise exception 'FAIL: two pending proposals allowed for one invitation_guest';
  exception
    when unique_violation then raise notice 'OK: a second pending proposal is rejected by the partial unique index';
    when others then if sqlerrm like 'FAIL:%' then raise; else raise notice 'OK: rejected (%)', sqlerrm; end if;
  end;
end $$;

-- ===== authority is DERIVED precisely: a wedding OWNER acting WITHOUT a delegation is 'operator', not 'proxy' =====
-- Also asserts audit_event carries STRUCTURED channel/authority columns (not just interpolated text).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a010')::text, true); -- owner, no delegation to this guest
do $$ declare pid uuid; v_auth app.rsvp_authority; v_chan app.rsvp_channel; v_a_chan app.rsvp_channel; v_a_auth app.rsvp_authority; begin
  pid := public.propose_rsvp_change('55555555-0000-0000-0000-00000000a061'::uuid,'tentative'::app.attendance_status);
  perform public.confirm_rsvp_change(pid);
  select responded_as, responded_channel into v_auth, v_chan
    from app.event_attendance where invitation_guest_id='55555555-0000-0000-0000-00000000a061';
  if v_auth <> 'operator' then raise exception 'FAIL: owner-without-delegation labeled % (expected operator)', v_auth; end if;
  if v_chan <> 'web' then raise exception 'FAIL: channel not web (got %)', v_chan; end if;
  -- structured audit provenance: typed columns, queryable — not parsed out of safe_summary text
  select channel, authority into v_a_chan, v_a_auth
    from app.audit_event where wedding_id='55555555-0000-0000-0000-00000000aa01' and action='rsvp'
    order by at desc limit 1;
  if v_a_chan is distinct from 'web'::app.rsvp_channel or v_a_auth is distinct from 'operator'::app.rsvp_authority then
    raise exception 'FAIL: audit_event structured provenance wrong (chan=%, auth=%)', v_a_chan, v_a_auth;
  end if;
  raise notice 'OK: owner derives authority=operator; audit_event carries structured channel=web / authority=operator';
end $$;
reset role;

-- ===== cross-actor confirmation is REJECTED: a delegate proposes, the OWNER must not confirm it =====
-- (Regression for the provenance P1 where a confirmer's identity + the proposer's authority disagreed.)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a030')::text, true); -- active delegate for guest a021
do $$ declare pid uuid; begin
  pid := public.propose_rsvp_change('55555555-0000-0000-0000-00000000a061'::uuid,'declined'::app.attendance_status); -- delegate proposes
  perform set_config('request.jwt.claims', json_build_object('sub','aaaa1111-0000-0000-0000-00000000a010')::text, true); -- switch to OWNER
  begin
    perform public.confirm_rsvp_change(pid);
    raise exception 'FAIL: owner confirmed a delegate''s proposal (cross-actor attribution)';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'OK: cross-actor confirm rejected (%)', sqlerrm;
  end;
end $$;
reset role;

select 'ALL ADVERSARIAL RLS TESTS PASSED' as result;
rollback;
