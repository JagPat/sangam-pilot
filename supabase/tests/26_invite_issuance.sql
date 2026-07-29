-- 26_invite_issuance.sql — host link issuance must derive the recipient contact inside PostgreSQL.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('26661111-0000-0000-0000-000000000001','invite-owner@example.test') on conflict do nothing;
insert into app.wedding(id,title) values
  ('26665555-0000-0000-0000-000000000001','Invite issuance') on conflict do nothing;
insert into app.account(id,auth_user_id,email) values
  ('2666aaaa-0000-0000-0000-000000000001','26661111-0000-0000-0000-000000000001','invite-owner@example.test') on conflict do nothing;
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('26665555-0000-0000-0000-000000000001','2666aaaa-0000-0000-0000-000000000001','active') on conflict do nothing;
insert into app.operator_role(wedding_id,account_id,role) values
  ('26665555-0000-0000-0000-000000000001','2666aaaa-0000-0000-0000-000000000001','wedding_owner') on conflict do nothing;
insert into app.household(id,wedding_id,name) values
  ('2666bbbb-0000-0000-0000-000000000001','26665555-0000-0000-0000-000000000001','Invite household') on conflict do nothing;
insert into app.guest(id,wedding_id,household_id,full_name) values
  ('2666cccc-0000-0000-0000-000000000001','26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','Invite guest') on conflict do nothing;
insert into app.household_contact(wedding_id,household_id,guest_id,channel,value,is_shared) values
  ('26665555-0000-0000-0000-000000000001','2666bbbb-0000-0000-0000-000000000001','2666cccc-0000-0000-0000-000000000001','email','stored-contact@example.test',false);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','26661111-0000-0000-0000-000000000001')::text, true);

do $$
declare v_raw text; v_hash text; v_contact_hash text;
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

  v_raw := app.issue_guest_access_link(
    '26665555-0000-0000-0000-000000000001',
    '2666cccc-0000-0000-0000-000000000001',
    interval '30 days'
  );
  select token_hash,contact_hash into v_hash,v_contact_hash
    from app.guest_access_link
   where wedding_id='26665555-0000-0000-0000-000000000001'
     and guest_id='2666cccc-0000-0000-0000-000000000001'
   order by issued_at desc limit 1;
  if v_hash = v_raw then raise exception 'FAIL(invite issuance): raw token was stored'; end if;
  if v_contact_hash <> encode(digest('stored-contact@example.test','sha256'),'hex') then
    raise exception 'FAIL(invite issuance): wrapper did not hash the stored recipient contact';
  end if;
  raise notice 'OK(invite issuance): authenticated cannot choose a contact; wrapper derives the stored email';
end $$;

reset role;
rollback;
