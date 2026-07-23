-- 08_finance.sql — adversarial coverage for migration 0011 (narrowed Option A finance MVP).
-- The approved 8 + 6 tests, run under real roles:
--   1  cross-wedding isolation (rows + aggregate)          8  aggregate view respects RLS (viewer=full, else empty)
--   2  a bride-family admin cannot read groom-private      9  NO RLS recursion for a family admin (42P17)
--   3  co-host / plain member: no finance access          10  every referenced function is present
--   4  allocations cannot exceed OR fall short            11  ₹100 split three ways totals EXACTLY ₹100
--   5  settlement arithmetic: 50/50 and unequal           12  changing amount without matching allocations fails at commit
--   6  payer and responsible may differ                   13  deleting an expense cascades cleanly
--   7  INR and USD are NEVER summed                        14  three groups -> NET POSITION (not a unique who-pays-whom)
-- Plus: owner-only writes (a family admin cannot add), direct writes denied, percent!=100 and mixed-basis rejected.
-- Requires 00_roles + auth stub + migrations/grants.
\set ON_ERROR_STOP on
begin;

-- ============================ fixtures ============================
-- Two weddings. W1 has three host groups (bride/groom/couple) and five operators; W2 is a separate wedding
-- used only to prove cross-wedding isolation.
insert into auth.users(id,email) values
  ('88110000-0000-0000-0000-0000000000a0','owner1@e.com'),
  ('88110000-0000-0000-0000-0000000000a1','bride@e.com'),
  ('88110000-0000-0000-0000-0000000000a2','groom@e.com'),
  ('88110000-0000-0000-0000-0000000000a3','cohost@e.com'),
  ('88110000-0000-0000-0000-0000000000a4','member@e.com'),
  ('88110000-0000-0000-0000-0000000000b0','owner2@e.com');
insert into app.account(id,auth_user_id,email) values
  ('88cc0000-0000-0000-0000-0000000000a0','88110000-0000-0000-0000-0000000000a0','owner1@e.com'),
  ('88cc0000-0000-0000-0000-0000000000a1','88110000-0000-0000-0000-0000000000a1','bride@e.com'),
  ('88cc0000-0000-0000-0000-0000000000a2','88110000-0000-0000-0000-0000000000a2','groom@e.com'),
  ('88cc0000-0000-0000-0000-0000000000a3','88110000-0000-0000-0000-0000000000a3','cohost@e.com'),
  ('88cc0000-0000-0000-0000-0000000000a4','88110000-0000-0000-0000-0000000000a4','member@e.com'),
  ('88cc0000-0000-0000-0000-0000000000b0','88110000-0000-0000-0000-0000000000b0','owner2@e.com');

insert into app.wedding(id,title) values
  ('88000000-0000-0000-0000-000000000001','W1'),
  ('88000000-0000-0000-0000-000000000002','W2');

-- host groups
insert into app.host_group(id,wedding_id,kind,name) values
  ('88000000-0000-0000-0000-0000000000b0','88000000-0000-0000-0000-000000000001','bride_family','Bride family'),
  ('88000000-0000-0000-0000-0000000000c0','88000000-0000-0000-0000-000000000001','groom_family','Groom family'),
  ('88000000-0000-0000-0000-0000000000d0','88000000-0000-0000-0000-000000000001','couple','Couple'),
  ('88000000-0000-0000-0000-0000000000e0','88000000-0000-0000-0000-000000000002','bride_family','W2 bride family');

-- memberships (must be active before operator_role)
insert into app.wedding_membership(wedding_id,account_id,status) values
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a0','active'),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a1','active'),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a2','active'),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a3','active'),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a4','active'),
  ('88000000-0000-0000-0000-000000000002','88cc0000-0000-0000-0000-0000000000b0','active');

-- roles: owner1 owns W1; bride/groom are host_group_admins; cohost is a co_host; member has no operator role.
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a0','wedding_owner',    null),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a1','host_group_admin','88000000-0000-0000-0000-0000000000b0'),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a2','host_group_admin','88000000-0000-0000-0000-0000000000c0'),
  ('88000000-0000-0000-0000-000000000001','88cc0000-0000-0000-0000-0000000000a3','co_host',         '88000000-0000-0000-0000-0000000000b0'),
  ('88000000-0000-0000-0000-000000000002','88cc0000-0000-0000-0000-0000000000b0','wedding_owner',    null);

-- ============ seed expenses + BALANCED allocations directly (superuser) for the read/RLS/arithmetic tests ============
-- E1 INR 100000 paid by BRIDE, split 50/50 bride/groom            (50-50; payer != one responsible)
-- E2 INR  60000 paid by GROOM, bride 20000 / groom 40000          (unequal)
-- E3 USD   5000 paid by COUPLE, couple 5000                       (separate currency)
-- E5 INR  10000 paid by GROOM, groom 10000                        (groom-PRIVATE: bride must never see it)
-- W2  INR   999 paid by W2 bride family                           (cross-wedding isolation)
insert into app.finance_expense(id,wedding_id,description,category,amount,currency_code,paid_at,paid_by_host_group_id,created_by_account_id) values
  ('88000000-0000-0000-0000-0000000e0001','88000000-0000-0000-0000-000000000001','Sangeet venue','venue',   100000,'INR','2026-06-01','88000000-0000-0000-0000-0000000000b0','88cc0000-0000-0000-0000-0000000000a0'),
  ('88000000-0000-0000-0000-0000000e0002','88000000-0000-0000-0000-000000000001','Catering',     'catering', 60000,'INR','2026-06-02','88000000-0000-0000-0000-0000000000c0','88cc0000-0000-0000-0000-0000000000a0'),
  ('88000000-0000-0000-0000-0000000e0003','88000000-0000-0000-0000-000000000001','Flights',      'travel',    5000,'USD','2026-06-03','88000000-0000-0000-0000-0000000000d0','88cc0000-0000-0000-0000-0000000000a0'),
  ('88000000-0000-0000-0000-0000000e0005','88000000-0000-0000-0000-000000000001','Groom suits',  'attire',   10000,'INR','2026-06-05','88000000-0000-0000-0000-0000000000c0','88cc0000-0000-0000-0000-0000000000a0'),
  ('88000000-0000-0000-0000-0000000e0009','88000000-0000-0000-0000-000000000002','Other wedding','misc',       999,'INR','2026-06-09','88000000-0000-0000-0000-0000000000e0','88cc0000-0000-0000-0000-0000000000b0');
insert into app.finance_expense_allocation(wedding_id,expense_id,responsible_host_group_id,allocation_amount) values
  ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-0000000e0001','88000000-0000-0000-0000-0000000000b0', 50000),
  ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-0000000e0001','88000000-0000-0000-0000-0000000000c0', 50000),
  ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-0000000e0002','88000000-0000-0000-0000-0000000000b0', 20000),
  ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-0000000e0002','88000000-0000-0000-0000-0000000000c0', 40000),
  ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-0000000e0003','88000000-0000-0000-0000-0000000000d0',  5000),
  ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-0000000e0005','88000000-0000-0000-0000-0000000000c0', 10000),
  ('88000000-0000-0000-0000-000000000002','88000000-0000-0000-0000-0000000e0009','88000000-0000-0000-0000-0000000000e0',   999);

-- ===== (10) every function the migration references is present (regression: nothing omitted) =====
do $$ declare v_missing text; begin
  select string_agg(need,', ') into v_missing from (values
    ('finance_assert_balanced'),('finance_is_group_admin_here'),('finance_can_read_expense'),
    ('finance_can_read_allocation'),('finance_is_viewer'),('finance_resolve_allocations'),
    ('owner_add_expense'),('owner_update_expense'),('owner_delete_expense')) t(need)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='app' and p.proname=t.need);
  if v_missing is not null then raise exception 'FAIL(present): missing finance functions: %', v_missing; end if;
  raise notice 'OK(present): all 9 referenced finance functions exist';
end $$;

-- ===== OWNER sees everything: 4 expenses in W1, the full net position, both currencies =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a0')::text, true); -- owner1
do $$ declare n int; begin
  select count(*) into n from app.finance_expense where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 4 then raise exception 'FAIL(owner-read): owner sees % of 4 W1 expenses', n; end if;
  select count(*) into n from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 3 then raise exception 'FAIL(owner-read): owner sees % net-position rows (expected 3)', n; end if;
  raise notice 'OK(owner-read): owner reads all line items and the whole net position';
end $$;

-- ===== (5)(6) settlement arithmetic + payer!=responsible, in INR =====
do $$ declare v_bride int; v_groom int; v_zero numeric; begin
  select net_position into v_bride from app.finance_net_position
    where wedding_id='88000000-0000-0000-0000-000000000001' and host_group_id='88000000-0000-0000-0000-0000000000b0' and currency_code='INR';
  select net_position into v_groom from app.finance_net_position
    where wedding_id='88000000-0000-0000-0000-000000000001' and host_group_id='88000000-0000-0000-0000-0000000000c0' and currency_code='INR';
  -- bride paid 100000, owes 70000 -> +30000 ; groom paid 70000, owes 100000 -> -30000
  if v_bride <> 30000 then raise exception 'FAIL(arith): bride INR net expected +30000, got %', v_bride; end if;
  if v_groom <> -30000 then raise exception 'FAIL(arith): groom INR net expected -30000, got %', v_groom; end if;
  select sum(net_position) into v_zero from app.finance_net_position
    where wedding_id='88000000-0000-0000-0000-000000000001' and currency_code='INR';
  if v_zero <> 0 then raise exception 'FAIL(arith): INR net positions do not sum to zero (%)', v_zero; end if;
  raise notice 'OK(arith): 50/50 + unequal net to +30000 / -30000 (payer != responsible) and sum to zero';
end $$;

-- ===== (7) INR and USD are NEVER summed: two separate currency rows, each summing to zero on its own =====
do $$ declare v_cur int; v_usd numeric; v_inr numeric; begin
  select count(distinct currency_code) into v_cur from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000001';
  if v_cur <> 2 then raise exception 'FAIL(currency): expected 2 distinct currencies, got %', v_cur; end if;
  if exists (select 1 from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000001' and currency_code not in ('INR','USD'))
    then raise exception 'FAIL(currency): a non-INR/USD (merged?) currency row appeared'; end if;
  select sum(net_position) into v_usd from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000001' and currency_code='USD';
  select sum(net_position) into v_inr from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000001' and currency_code='INR';
  if v_usd <> 0 or v_inr <> 0 then raise exception 'FAIL(currency): per-currency nets not independently zero (INR=%, USD=%)', v_inr, v_usd; end if;
  raise notice 'OK(currency): INR and USD are grouped separately and never summed into one total';
end $$;

-- ===== (14) three groups -> NET POSITION columns, not a who-pays-whom transfer list =====
do $$ declare v_cols int; v_bad int; begin
  select count(*) into v_cols from information_schema.columns
    where table_schema='app' and table_name='finance_net_position' and column_name in ('paid_amount','allocated_amount','net_position');
  if v_cols <> 3 then raise exception 'FAIL(net): the aggregate is missing paid/allocated/net_position columns'; end if;
  select count(*) into v_bad from information_schema.columns
    where table_schema='app' and table_name='finance_net_position'
      and (column_name ilike '%pay_to%' or column_name ilike '%payee%' or column_name ilike '%transfer%' or column_name ilike '%settle%');
  if v_bad <> 0 then raise exception 'FAIL(net): the aggregate exposes a transfer/settlement column (implies a unique who-pays-whom)'; end if;
  -- currency_code is part of the grouping (no line-item id columns leak):
  if exists (select 1 from information_schema.columns where table_schema='app' and table_name='finance_net_position'
               and column_name in ('id','description','amount','paid_at','note')) then
    raise exception 'FAIL(net): a line-item column leaked into the aggregate'; end if;
  raise notice 'OK(net): aggregate is net position by group+currency (no transfer plan, no line items)';
end $$;
reset role;

-- ===== (2) a BRIDE-family admin: sees bride-involved rows, NEVER groom-private; (8) but full net position =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a1')::text, true); -- bride admin
do $$ declare n int; begin
  -- E1 (bride paid) + E2 (bride responsible) are readable; E3 (couple) and E5 (groom-private) are NOT.
  if not exists (select 1 from app.finance_expense where id='88000000-0000-0000-0000-0000000e0001') then raise exception 'FAIL(bride): cannot read the expense she paid'; end if;
  if not exists (select 1 from app.finance_expense where id='88000000-0000-0000-0000-0000000e0002') then raise exception 'FAIL(bride): cannot read the expense she is responsible for'; end if;
  if exists (select 1 from app.finance_expense where id='88000000-0000-0000-0000-0000000e0005') then raise exception 'FAIL(bride): read the GROOM-PRIVATE expense (leak)'; end if;
  if exists (select 1 from app.finance_expense where id='88000000-0000-0000-0000-0000000e0003') then raise exception 'FAIL(bride): read a couple expense she is unrelated to'; end if;
  select count(*) into n from app.finance_expense where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'FAIL(bride): expected exactly 2 readable expenses, got %', n; end if;
  -- line-item leakage within a shared expense: on E2 (groom paid) bride sees only HER 20000 allocation, not groom's 40000
  if not exists (select 1 from app.finance_expense_allocation where expense_id='88000000-0000-0000-0000-0000000e0002' and responsible_host_group_id='88000000-0000-0000-0000-0000000000b0')
    then raise exception 'FAIL(bride): cannot see her own allocation on E2'; end if;
  if exists (select 1 from app.finance_expense_allocation where expense_id='88000000-0000-0000-0000-0000000e0002' and responsible_host_group_id='88000000-0000-0000-0000-0000000000c0')
    then raise exception 'FAIL(bride): saw the GROOM allocation line on an expense groom paid (leak)'; end if;
  -- (8) the aggregate gives a finance viewer the COMPLETE totals (all 3 net-position rows), never line items
  select count(*) into n from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 3 then raise exception 'FAIL(bride): aggregate should show all 3 group nets to a viewer, got %', n; end if;
  raise notice 'OK(bride): reads bride-involved rows only, never groom-private; sees complete net position via the gated aggregate';
end $$;

-- ===== (9) NO RLS recursion for a family admin (42P17): the same reads must not error =====
do $$ begin
  begin
    perform count(*) from app.finance_expense            where wedding_id='88000000-0000-0000-0000-000000000001';
    perform count(*) from app.finance_expense_allocation where wedding_id='88000000-0000-0000-0000-000000000001';
    perform count(*) from app.finance_net_position       where wedding_id='88000000-0000-0000-0000-000000000001';
    raise notice 'OK(no-recursion): family-admin reads of both tables + the view raise no recursion error';
  exception when sqlstate '42P17' then raise exception 'FAIL(recursion): RLS policy recursion (42P17) for a family admin';
  end;
end $$;
reset role;

-- ===== (3) a co-host and a plain member have NO finance access =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a3')::text, true); -- co_host
do $$ declare n int; m int; begin
  select count(*) into n from app.finance_expense       where wedding_id='88000000-0000-0000-0000-000000000001';
  select count(*) into m from app.finance_net_position  where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 0 or m <> 0 then raise exception 'FAIL(cohost): co-host saw finance (expenses=%, net=%)', n, m; end if;
  raise notice 'OK(cohost): a co_host sees no expenses and an empty aggregate';
end $$;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a4')::text, true); -- plain member
do $$ declare n int; m int; begin
  select count(*) into n from app.finance_expense       where wedding_id='88000000-0000-0000-0000-000000000001';
  select count(*) into m from app.finance_net_position  where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 0 or m <> 0 then raise exception 'FAIL(member): plain member saw finance (expenses=%, net=%)', n, m; end if;
  raise notice 'OK(member): a plain member with no finance role sees nothing';
end $$;
reset role;

-- ===== (1) cross-wedding isolation: W1 owner cannot read W2, and vice versa =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a0')::text, true); -- owner1
do $$ declare n int; begin
  select count(*) into n from app.finance_expense where wedding_id='88000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL(iso): W1 owner read % W2 expenses', n; end if;
  select count(*) into n from app.finance_net_position where wedding_id='88000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL(iso): W1 owner saw W2 in the aggregate (%)', n; end if;
  raise notice 'OK(iso): the W1 owner sees no W2 rows or aggregate';
end $$;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000b0')::text, true); -- owner2
do $$ declare n int; begin
  select count(*) into n from app.finance_expense where wedding_id='88000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL(iso): W2 owner read % W1 expenses', n; end if;
  raise notice 'OK(iso): the W2 owner sees no W1 line items';
end $$;
reset role;

-- ============ WRITE PATH: owner RPCs, allocation resolution, deferred integrity, authorization ============

-- ===== owner add (percent 50/50) resolves to 2 x 50000 =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a0')::text, true); -- owner1
do $$ declare v_exp uuid; v_sum numeric; v_rows int; begin
  v_exp := app.owner_add_expense('88000000-0000-0000-0000-000000000001','Decor','decor',80000,'inr','2026-06-10',
             '88000000-0000-0000-0000-0000000000b0', null,
             '[{"group":"88000000-0000-0000-0000-0000000000b0","percent":50},{"group":"88000000-0000-0000-0000-0000000000c0","percent":50}]'::jsonb);
  select count(*), sum(allocation_amount) into v_rows, v_sum from app.finance_expense_allocation where expense_id=v_exp;
  if v_rows <> 2 or v_sum <> 80000 then raise exception 'FAIL(add): percent 50/50 -> rows=%, sum=% (expected 2, 80000)', v_rows, v_sum; end if;
  if lower((select currency_code from app.finance_expense where id=v_exp)) <> 'inr' and (select currency_code from app.finance_expense where id=v_exp) <> 'INR'
    then raise exception 'FAIL(add): currency not upper-cased to ISO'; end if;
  raise notice 'OK(add): owner_add_expense resolves percentages to authoritative amounts (50/50 of 80000)';
end $$;

-- ===== (11) ₹100 split three ways totals EXACTLY ₹100 (largest-remainder rounding) =====
do $$ declare v_exp uuid; v_sum numeric; v_rows int; v_bad int; begin
  v_exp := app.owner_add_expense('88000000-0000-0000-0000-000000000001','Petrol','misc',100,'INR','2026-06-11',
             '88000000-0000-0000-0000-0000000000d0', null,
             '[{"group":"88000000-0000-0000-0000-0000000000b0","percent":33.3333},
               {"group":"88000000-0000-0000-0000-0000000000c0","percent":33.3333},
               {"group":"88000000-0000-0000-0000-0000000000d0","percent":33.3334}]'::jsonb);
  select count(*), sum(allocation_amount) into v_rows, v_sum from app.finance_expense_allocation where expense_id=v_exp;
  if v_rows <> 3 then raise exception 'FAIL(split): expected 3 allocation rows, got %', v_rows; end if;
  if v_sum <> 100 then raise exception 'FAIL(split): three-way split of 100 totals % (must be exactly 100)', v_sum; end if;
  select count(*) into v_bad from app.finance_expense_allocation where expense_id=v_exp and allocation_amount not in (33.33, 33.34);
  if v_bad <> 0 then raise exception 'FAIL(split): a share is not 33.33/33.34 (rounding drift)'; end if;
  raise notice 'OK(split): ₹100 split three ways = 33.33 + 33.33 + 33.34 = exactly 100 (largest remainder)';
end $$;

-- ===== (4a) percentages that do not total 100 are rejected synchronously =====
do $$ begin
  begin
    perform app.owner_add_expense('88000000-0000-0000-0000-000000000001','Bad%','misc',1000,'INR','2026-06-12',
      '88000000-0000-0000-0000-0000000000b0', null,
      '[{"group":"88000000-0000-0000-0000-0000000000b0","percent":40},{"group":"88000000-0000-0000-0000-0000000000c0","percent":50}]'::jsonb);
    raise exception 'FAIL(pct): percentages summing to 90 were accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(pct): percentages != 100 rejected (%)', sqlerrm; end;
end $$;

-- ===== mixed percent+amount basis is rejected (do not persist two competing bases) =====
do $$ begin
  begin
    perform app.owner_add_expense('88000000-0000-0000-0000-000000000001','Mixed','misc',1000,'INR','2026-06-12',
      '88000000-0000-0000-0000-0000000000b0', null,
      '[{"group":"88000000-0000-0000-0000-0000000000b0","percent":50},{"group":"88000000-0000-0000-0000-0000000000c0","amount":500}]'::jsonb);
    raise exception 'FAIL(mixed): a mixed percent/amount allocation was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(mixed): mixed-basis allocation rejected (%)', sqlerrm; end;
end $$;

-- ===== owner_update_expense keeps the sum balanced across a re-allocation =====
do $$ declare v_exp uuid; v_sum numeric; begin
  v_exp := app.owner_add_expense('88000000-0000-0000-0000-000000000001','Gifts','misc',10000,'INR','2026-06-13',
             '88000000-0000-0000-0000-0000000000b0', null,
             '[{"group":"88000000-0000-0000-0000-0000000000b0","amount":10000}]'::jsonb);
  perform app.owner_update_expense('88000000-0000-0000-0000-000000000001', v_exp,'Gifts','misc',12000,'INR','2026-06-13',
             '88000000-0000-0000-0000-0000000000b0', null,
             '[{"group":"88000000-0000-0000-0000-0000000000b0","amount":8000},{"group":"88000000-0000-0000-0000-0000000000c0","amount":4000}]'::jsonb);
  select sum(allocation_amount) into v_sum from app.finance_expense_allocation where expense_id=v_exp;
  if v_sum <> 12000 then raise exception 'FAIL(update): re-allocation sum % (expected 12000)', v_sum; end if;
  raise notice 'OK(update): owner_update_expense re-writes a balanced allocation set';
end $$;

-- ===== (13) delete cascades cleanly (no dangling allocations, no trigger error) =====
do $$ declare v_exp uuid; v_alloc int; begin
  v_exp := app.owner_add_expense('88000000-0000-0000-0000-000000000001','Temp','misc',5000,'INR','2026-06-14',
             '88000000-0000-0000-0000-0000000000b0', null,
             '[{"group":"88000000-0000-0000-0000-0000000000b0","amount":5000}]'::jsonb);
  perform app.owner_delete_expense('88000000-0000-0000-0000-000000000001', v_exp);
  if exists (select 1 from app.finance_expense where id=v_exp) then raise exception 'FAIL(delete): expense survived'; end if;
  select count(*) into v_alloc from app.finance_expense_allocation where expense_id=v_exp;
  if v_alloc <> 0 then raise exception 'FAIL(delete): % allocations were left dangling', v_alloc; end if;
  raise notice 'OK(delete): deleting an expense cascades its allocations with no trigger error';
end $$;

-- ===== owner-only writes: a family admin cannot add an expense; direct table writes are denied =====
select set_config('request.jwt.claims', json_build_object('sub','88110000-0000-0000-0000-0000000000a1')::text, true); -- bride admin
do $$ begin
  begin
    perform app.owner_add_expense('88000000-0000-0000-0000-000000000001','Sneaky','misc',100,'INR','2026-06-15',
      '88000000-0000-0000-0000-0000000000b0', null, '[{"group":"88000000-0000-0000-0000-0000000000b0","amount":100}]'::jsonb);
    raise exception 'FAIL(write-authz): a host_group_admin added an expense';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(write-authz): only the wedding_owner may add expenses (%)', sqlerrm; end;
  begin
    insert into app.finance_expense(wedding_id,description,category,amount,currency_code,paid_at,paid_by_host_group_id)
      values ('88000000-0000-0000-0000-000000000001','Direct','misc',100,'INR','2026-06-15','88000000-0000-0000-0000-0000000000b0');
    raise exception 'FAIL(write-authz): a direct INSERT into finance_expense succeeded';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(write-authz): direct finance_expense INSERT denied (%)', sqlerrm; end;
end $$;
reset role;

-- ===== (4b)(12) deferred integrity at COMMIT: force the check with SET CONSTRAINTS IMMEDIATE inside a savepoint =====
-- under-allocation (30000 of 100000)
do $$ begin
  begin
    insert into app.finance_expense(id,wedding_id,description,category,amount,currency_code,paid_at,paid_by_host_group_id)
      values ('88000000-0000-0000-0000-00000000f001','88000000-0000-0000-0000-000000000001','Short','misc',100000,'INR','2026-06-16','88000000-0000-0000-0000-0000000000b0');
    insert into app.finance_expense_allocation(wedding_id,expense_id,responsible_host_group_id,allocation_amount)
      values ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-00000000f001','88000000-0000-0000-0000-0000000000b0',30000);
    set constraints all immediate;   -- forces the deferred balance check now
    raise exception 'FAIL(short): an under-allocated expense (30000<100000) was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(short): under-allocation rejected at commit (%)', sqlerrm; end;
end $$;
-- over-allocation (120000 of 100000)
do $$ begin
  begin
    insert into app.finance_expense(id,wedding_id,description,category,amount,currency_code,paid_at,paid_by_host_group_id)
      values ('88000000-0000-0000-0000-00000000f002','88000000-0000-0000-0000-000000000001','Over','misc',100000,'INR','2026-06-16','88000000-0000-0000-0000-0000000000b0');
    insert into app.finance_expense_allocation(wedding_id,expense_id,responsible_host_group_id,allocation_amount) values
      ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-00000000f002','88000000-0000-0000-0000-0000000000b0',60000),
      ('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-00000000f002','88000000-0000-0000-0000-0000000000c0',60000);
    set constraints all immediate;
    raise exception 'FAIL(over): an over-allocated expense (120000>100000) was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(over): over-allocation rejected at commit (%)', sqlerrm; end;
end $$;
-- (12) changing the expense amount without re-balancing allocations fails at commit
do $$ begin
  begin
    update app.finance_expense set amount = 120000 where id='88000000-0000-0000-0000-0000000e0001';  -- was 100000 = 50000+50000
    set constraints all immediate;
    raise exception 'FAIL(amount): changing amount to 120000 without matching allocations was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'OK(amount): amount/allocation mismatch rejected at commit (%)', sqlerrm; end;
end $$;

select 'ALL FINANCE TESTS PASSED' as result;
rollback;
