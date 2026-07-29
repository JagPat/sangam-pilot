-- 26_invite_issuance.sql — host link issuance must derive the recipient contact inside PostgreSQL.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('26661111-0000-0000-0000-000000000001','invite-owner@example.test'),
  ('26661111-0000-0000-0000-000000000002','invite-nonowner@example.test') on conflict do nothing;
insert into app.wedding(id,title) values
  ('26665555-0000-0000-0000-000000000001','Invite issuance') on conflict do nothing;
insert into app.account(id,auth_user_id,email) values
  ('2666aaaa-0000-0000-0000-000000000001','26661111-0000-0000-0000-000000000001','invite-owner@example.test'),
  ('2666aaaa-0000-0000-0000-000000000002','26661111-0000-0000-0000-000000000002','invite-nonowner@example.test') on conflict do nothing;
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('26665555-0000-0000-0000-000000000001','2666aaaa-0000-0000-0000-000000000001','active'),
  ('26665555-0000-0000-0000-000000000001','2666aaaa-0000-0000-0000-000000000002','active') on conflict do nothing;
insert into app.operator_role(wedding_id,account_id,role) values
  ('26665555-0000-0000-0000-000000000001','2666aaaa-0000-0000-0000-000000000001','wedding_owner') on conflict do nothing;
insert into app.household(id,wedding_id,name) values
  ('2666bbbb-0000-0000-0000-000000000001','26665555-0000-0000-0000-000000000001','Invite household') on conflict do nothing;
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('2666cccc-0000-0000-0000-000000000001','26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','Invite guest'),
  ('2666cccc-0000-0000-0000-000000000002','26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','Shared-only guest') on conflict do nothing;
insert into app.household_contact(wedding_id,household_id,guest_id,channel,value,is_shared) values
  ('26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','2666cccc-0000-0000-0000-000000000001','email','stored-contact@example.test',false),
  ('26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','2666cccc-0000-0000-0000-000000000001','email','shared-household@example.test',true),
  ('26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','2666cccc-0000-0000-0000-000000000002','email','shared-only@example.test',true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','26661111-0000-0000-0000-000000000001')::text, true);

do $$
begin
  begin
    perform app.issue_access_link(
      '26665555-0000-0000-0000-000000000001',
      '2666cccc-0000-0000-0000-000000000001',
      'attacker-chosen@example.test',
      interval '30 days'
    );
    raise exception 'FAIL(invite issuance): authenticated executed the arbitrary-contact RPC';
  exception
    when insufficient_privilege then null;
    when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  begin
    perform app.issue_guest_access_link(
      '2666aaaa-0000-0000-0000-000000000001',
      '26665555-0000-0000-0000-000000000001',
      '2666cccc-0000-0000-0000-000000000001'
    );
    raise exception 'FAIL(invite issuance): authenticated executed the server-only issuance RPC';
  exception
    when insufficient_privilege then null;
    when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

reset role;
set local role service_role;

do $$
declare v_raw text; v_hash text; v_contact_hash text; v_issued_at timestamptz; v_expires_at timestamptz;
begin
  begin
    perform app.issue_guest_access_link(
      '2666aaaa-0000-0000-0000-000000000002',
      '26665555-0000-0000-0000-000000000001',
      '2666cccc-0000-0000-0000-000000000001'
    );
    raise exception 'FAIL(invite issuance): non-owner actor issued a link through service role';
  exception
    when insufficient_privilege then null;
    when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  begin
    perform app.issue_guest_access_link(
      '2666aaaa-0000-0000-0000-000000000001',
      '26665555-0000-0000-0000-000000000001',
      '2666cccc-0000-0000-0000-000000000002'
    );
    raise exception 'FAIL(invite issuance): shared-only email was accepted';
  exception
    when sqlstate '22023' then null;
    when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;

  v_raw := app.issue_guest_access_link(
    '2666aaaa-0000-0000-0000-000000000001',
    '26665555-0000-0000-0000-000000000001',
    '2666cccc-0000-0000-0000-000000000001'
  );
  select token_hash,contact_hash,issued_at,expires_at into v_hash,v_contact_hash,v_issued_at,v_expires_at
    from app.guest_access_link
   where wedding_id='26665555-0000-0000-0000-000000000001'
     and guest_id='2666cccc-0000-0000-0000-000000000001'
   order by issued_at desc limit 1;
  if v_hash = v_raw then raise exception 'FAIL(invite issuance): raw token was stored'; end if;
  if v_contact_hash <> encode(digest('stored-contact@example.test','sha256'),'hex') then
    raise exception 'FAIL(invite issuance): issuer did not use the guest-specific unshared email';
  end if;
  if v_expires_at <> v_issued_at + interval '30 days' then
    raise exception 'FAIL(invite issuance): expiry was not fixed to 30 days';
  end if;
  raise notice 'OK(invite issuance): service-only owner issuance uses one personal email and fixed 30-day expiry';
end $$;

reset role;
rollback;
