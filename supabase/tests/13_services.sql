-- 13_services.sql — coverage for migration 0019 (services + guest service requests).
-- Proves: the owner defines the catalogue (included / allowance / guest_paid); a member can READ the menu but
-- cannot write it; a guest creates and sees only their own household/self requests, is blocked from another
-- household's, and cannot double-book; the owner sees and settles everything. Requires 00_roles + auth stub +
-- migrations/grants (through 0019).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('fb120000-0000-0000-0000-0000000000a0','svcowner@e.com'),
  ('fb120000-0000-0000-0000-0000000000b1','svcguest1@e.com'),
  ('fb120000-0000-0000-0000-0000000000b2','svcguest2@e.com');
insert into app.account(id,auth_user_id,email) values
  ('fbdd0000-0000-0000-0000-0000000000a0','fb120000-0000-0000-0000-0000000000a0','svcowner@e.com'),
  ('fbdd0000-0000-0000-0000-0000000000b1','fb120000-0000-0000-0000-0000000000b1','svcguest1@e.com'),
  ('fbdd0000-0000-0000-0000-0000000000b2','fb120000-0000-0000-0000-0000000000b2','svcguest2@e.com');
insert into app.wedding(id,title) values ('fb010000-0000-0000-0000-000000000001','SVC Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('fb010000-0000-0000-0000-000000000001','fbdd0000-0000-0000-0000-0000000000a0','active'),
  ('fb010000-0000-0000-0000-000000000001','fbdd0000-0000-0000-0000-0000000000b1','active'),
  ('fb010000-0000-0000-0000-000000000001','fbdd0000-0000-0000-0000-0000000000b2','active');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('fb010000-0000-0000-0000-000000000001','fbdd0000-0000-0000-0000-0000000000a0','wedding_owner',null);
insert into app.household(id,wedding_id,name) values
  ('fb010000-0000-0000-0000-0000000000a1','fb010000-0000-0000-0000-000000000001','HH One'),
  ('fb010000-0000-0000-0000-0000000000a2','fb010000-0000-0000-0000-000000000001','HH Two');
insert into app.guest(id,wedding_id,household_id,full_name,self_account_id) values
  ('fb010000-0000-0000-0000-0000000000d1','fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000a1','Guest One','fbdd0000-0000-0000-0000-0000000000b1'),
  ('fb010000-0000-0000-0000-0000000000d2','fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000a2','Guest Two','fbdd0000-0000-0000-0000-0000000000b2');

-- fixed service ids so later blocks can reference them
-- S1 hamper (included, per_household), S2 pickup (allowance 1, per_household), S3 spa (guest_paid, per_person)
\set s1 '''fb010000-0000-0000-0000-0000000000f1'''
\set s2 '''fb010000-0000-0000-0000-0000000000f2'''
\set s3 '''fb010000-0000-0000-0000-0000000000f3'''

-- ===== owner defines the catalogue =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','fb120000-0000-0000-0000-0000000000a0')::text, true);
do $$ begin
  insert into app.service(id,wedding_id,name,billing,scope,price_cents,included_qty) values
    ('fb010000-0000-0000-0000-0000000000f1','fb010000-0000-0000-0000-000000000001','Welcome hamper','included','per_household',0,null),
    ('fb010000-0000-0000-0000-0000000000f2','fb010000-0000-0000-0000-000000000001','Airport pickup','allowance','per_household',150000,1),
    ('fb010000-0000-0000-0000-0000000000f3','fb010000-0000-0000-0000-000000000001','Spa treatment','guest_paid','per_person',250000,null);
  raise notice 'OK(setup): owner listed 3 services across all three billing tiers';
end $$;

-- allowance integrity: an allowance service with no included_qty must be refused
do $$ begin
  begin
    insert into app.service(wedding_id,name,billing,scope,price_cents) values
      ('fb010000-0000-0000-0000-000000000001','Bad allowance','allowance','per_person',1000);
    raise exception 'FAIL(check): allowance service without included_qty was accepted';
  exception when check_violation then null; end;
  raise notice 'OK(check): allowance requires included_qty';
end $$;

-- ===== Guest One: reads the menu, cannot edit it, books own, blocked from others =====
select set_config('request.jwt.claims', json_build_object('sub','fb120000-0000-0000-0000-0000000000b1')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.service; if n<>3 then raise exception 'FAIL(menu): guest sees % services (expected 3)', n; end if;
  raise notice 'OK(guest1): reads the 3-item menu';

  -- cannot create a catalogue item (WITH CHECK is owner-only)
  begin
    insert into app.service(wedding_id,name,billing,scope) values ('fb010000-0000-0000-0000-000000000001','Sneaky','guest_paid','per_person');
    raise exception 'FAIL(cat): guest inserted a service';
  exception when insufficient_privilege then null; end;
  -- cannot edit a catalogue item (owner-only USING ⇒ zero rows touched, silently)
  update app.service set price_cents = 1 where id = 'fb010000-0000-0000-0000-0000000000f3';
  get diagnostics n = row_count; if n<>0 then raise exception 'FAIL(cat): guest updated % service rows', n; end if;
  raise notice 'OK(guest1): cannot add or edit catalogue items';

  -- books spa for self (per_person) and hamper for the household (per_household)
  insert into app.service_request(wedding_id,service_id,household_id,guest_id,qty) values
    ('fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000f3','fb010000-0000-0000-0000-0000000000a1','fb010000-0000-0000-0000-0000000000d1',2);
  insert into app.service_request(wedding_id,service_id,household_id,guest_id,qty) values
    ('fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000f1','fb010000-0000-0000-0000-0000000000a1',null,1);
  select count(*) into n from app.service_request; if n<>2 then raise exception 'FAIL(book): guest sees % of own requests (expected 2)', n; end if;
  raise notice 'OK(guest1): booked spa (self) + hamper (household), sees only their 2';

  -- one active request per (service, person): a second spa for self is refused
  begin
    insert into app.service_request(wedding_id,service_id,household_id,guest_id,qty) values
      ('fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000f3','fb010000-0000-0000-0000-0000000000a1','fb010000-0000-0000-0000-0000000000d1',1);
    raise exception 'FAIL(dupe): a second active spa request was accepted';
  exception when unique_violation then null; end;
  raise notice 'OK(guest1): cannot double-book the same service';

  -- cannot request for another guest, nor a household they cannot act for
  begin
    insert into app.service_request(wedding_id,service_id,household_id,guest_id,qty) values
      ('fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000f3','fb010000-0000-0000-0000-0000000000a2','fb010000-0000-0000-0000-0000000000d2',1);
    raise exception 'FAIL(cross): guest booked for Guest Two';
  exception when insufficient_privilege then null; when unique_violation then raise exception 'FAIL(cross): reached unique check (should be RLS-denied)'; end;
  begin
    insert into app.service_request(wedding_id,service_id,household_id,guest_id,qty) values
      ('fb010000-0000-0000-0000-000000000001','fb010000-0000-0000-0000-0000000000f1','fb010000-0000-0000-0000-0000000000a2',null,1);
    raise exception 'FAIL(cross): guest booked a service for HH Two';
  exception when insufficient_privilege then null; end;
  raise notice 'OK(guest1): refused booking for another guest / household';
end $$;

-- ===== Guest Two: isolated view =====
select set_config('request.jwt.claims', json_build_object('sub','fb120000-0000-0000-0000-0000000000b2')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.service;         if n<>3 then raise exception 'FAIL(menu2): guest2 sees % services', n; end if;
  select count(*) into n from app.service_request; if n<>0 then raise exception 'FAIL(iso): guest2 sees % requests (expected 0 — none are theirs)', n; end if;
  raise notice 'OK(guest2): same menu, none of Guest One''s requests';
end $$;

-- ===== owner: sees all, settles a guest-paid request =====
select set_config('request.jwt.claims', json_build_object('sub','fb120000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.service_request; if n<>2 then raise exception 'FAIL(owner): owner sees % requests (expected 2)', n; end if;
  update app.service_request set settle='settled', status='delivered'
    where service_id='fb010000-0000-0000-0000-0000000000f3';
  get diagnostics n = row_count; if n<>1 then raise exception 'FAIL(settle): owner settled % rows (expected 1)', n; end if;
  raise notice 'OK(owner): sees both requests and settled the spa booking';
end $$;

reset role;
rollback;
