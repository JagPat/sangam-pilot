-- 16_group_vendors_finance.sql — coverage for migration 0022 (family-admin vendor read) + confirmation that
-- the 0011 finance RLS already scopes to a family admin. Proves a bride-side admin sees only vendors their
-- side sources (+ their engagements), cannot write vendors, and can read their side's expense + the net-
-- position split; the groom admin mirrors; the owner sees everything. Requires 00_roles + auth stub +
-- migrations/grants (through 0022).
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('fe110000-0000-0000-0000-0000000000a0','ov@vf.com'),
  ('fe110000-0000-0000-0000-0000000000b1','bride@vf.com'),
  ('fe110000-0000-0000-0000-0000000000c1','groom@vf.com');
insert into app.account(id,auth_user_id,email) values
  ('fecc0000-0000-0000-0000-0000000000a0','fe110000-0000-0000-0000-0000000000a0','ov@vf.com'),
  ('fecc0000-0000-0000-0000-0000000000b1','fe110000-0000-0000-0000-0000000000b1','bride@vf.com'),
  ('fecc0000-0000-0000-0000-0000000000c1','fe110000-0000-0000-0000-0000000000c1','groom@vf.com');
insert into app.wedding(id,title) values ('fe000000-0000-0000-0000-000000000001','VF Wedding');
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('fe000000-0000-0000-0000-000000000001','fecc0000-0000-0000-0000-0000000000a0','active'),
  ('fe000000-0000-0000-0000-000000000001','fecc0000-0000-0000-0000-0000000000b1','active'),
  ('fe000000-0000-0000-0000-000000000001','fecc0000-0000-0000-0000-0000000000c1','active');
insert into app.host_group(id,wedding_id,kind,name) values
  ('fe000000-0000-0000-0000-0000000000bf','fe000000-0000-0000-0000-000000000001','bride_family','Bride family'),
  ('fe000000-0000-0000-0000-0000000000cf','fe000000-0000-0000-0000-000000000001','groom_family','Groom family');
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('fe000000-0000-0000-0000-000000000001','fecc0000-0000-0000-0000-0000000000a0','wedding_owner',null),
  ('fe000000-0000-0000-0000-000000000001','fecc0000-0000-0000-0000-0000000000b1','host_group_admin','fe000000-0000-0000-0000-0000000000bf'),
  ('fe000000-0000-0000-0000-000000000001','fecc0000-0000-0000-0000-0000000000c1','host_group_admin','fe000000-0000-0000-0000-0000000000cf');

-- vendors: one per side + one unassigned (fixtures run as superuser → RLS not applied here)
insert into app.vendor(id,wedding_id,category,name,host_group_id) values
  ('fe000000-0000-0000-0000-0000000000d1'::uuid,'fe000000-0000-0000-0000-000000000001','decor','Bride Decor','fe000000-0000-0000-0000-0000000000bf'),
  ('fe000000-0000-0000-0000-0000000000d2'::uuid,'fe000000-0000-0000-0000-000000000001','music','Groom Band','fe000000-0000-0000-0000-0000000000cf'),
  ('fe000000-0000-0000-0000-0000000000d3'::uuid,'fe000000-0000-0000-0000-000000000001','photo','Shared Photographer',null);
insert into app.engagement(id,wedding_id,vendor_id,state,role_title) values
  ('fe000000-0000-0000-0000-0000000000e1'::uuid,'fe000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-0000000000d1'::uuid,'confirmed','Mandap décor'),
  ('fe000000-0000-0000-0000-0000000000e2'::uuid,'fe000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-0000000000d2'::uuid,'quoted','Live band');

set local role authenticated;

-- ===== owner logs an expense paid by the bride side, split 60/40 =====
select set_config('request.jwt.claims', json_build_object('sub','fe110000-0000-0000-0000-0000000000a0')::text, true);
do $$ begin
  perform app.owner_add_expense('fe000000-0000-0000-0000-000000000001','Décor advance','decor',100000,'INR',
    date '2026-08-01','fe000000-0000-0000-0000-0000000000bf', null,
    '[{"group":"fe000000-0000-0000-0000-0000000000bf","percent":60},{"group":"fe000000-0000-0000-0000-0000000000cf","percent":40}]'::jsonb);
  raise notice 'OK(setup): owner logged a bride-paid expense split 60/40';
end $$;

-- ===== bride admin: sees only their side's vendors, can't write, reads their finance =====
select set_config('request.jwt.claims', json_build_object('sub','fe110000-0000-0000-0000-0000000000b1')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.vendor; if n<>1 then raise exception 'FAIL(vendor): bride admin sees % vendors (expected their 1)', n; end if;
  select count(*) into n from app.vendor where host_group_id='fe000000-0000-0000-0000-0000000000cf'; if n<>0 then raise exception 'FAIL(vendor-leak): bride admin sees a groom vendor'; end if;
  select count(*) into n from app.vendor where id='fe000000-0000-0000-0000-0000000000d3'::uuid; if n<>0 then raise exception 'FAIL(vendor-leak): bride admin sees the unassigned vendor'; end if;
  select count(*) into n from app.engagement; if n<>1 then raise exception 'FAIL(eng): bride admin sees % engagements (expected 1)', n; end if;
  raise notice 'OK(bride-vendor): sees only their side''s vendor + engagement';

  begin
    insert into app.vendor(wedding_id,category,name,host_group_id)
      values ('fe000000-0000-0000-0000-000000000001','other','Sneaky','fe000000-0000-0000-0000-0000000000bf');
    raise exception 'FAIL(vendor-write): bride admin inserted a vendor';
  exception when insufficient_privilege then null; end;
  raise notice 'OK(bride-vendor): read-only — cannot add vendors';

  select count(*) into n from app.finance_expense; if n<1 then raise exception 'FAIL(fin): bride admin cannot read their side''s expense'; end if;
  select count(*) into n from app.finance_net_position where wedding_id='fe000000-0000-0000-0000-000000000001';
  if n<2 then raise exception 'FAIL(fin): bride admin sees % net-position rows (expected both sides'' split)', n; end if;
  raise notice 'OK(bride-finance): reads their expense + the full net-position split';
end $$;

-- ===== groom admin: mirror isolation on vendors =====
select set_config('request.jwt.claims', json_build_object('sub','fe110000-0000-0000-0000-0000000000c1')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.vendor; if n<>1 then raise exception 'FAIL(groom-vendor): groom admin sees % vendors', n; end if;
  select count(*) into n from app.vendor where host_group_id='fe000000-0000-0000-0000-0000000000bf'; if n<>0 then raise exception 'FAIL(groom-leak): groom admin sees a bride vendor'; end if;
  raise notice 'OK(groom-vendor): sees only their own side''s vendor';
end $$;

-- ===== owner: sees all vendors + engagements =====
select set_config('request.jwt.claims', json_build_object('sub','fe110000-0000-0000-0000-0000000000a0')::text, true);
do $$ declare n int; begin
  select count(*) into n from app.vendor;     if n<>3 then raise exception 'FAIL(owner): owner sees % vendors (expected 3)', n; end if;
  select count(*) into n from app.engagement; if n<>2 then raise exception 'FAIL(owner): owner sees % engagements (expected 2)', n; end if;
  raise notice 'OK(owner): owner sees every vendor + engagement';
end $$;

reset role;
rollback;
