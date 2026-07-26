-- 0011_finance_mvp.sql
-- Narrowed Option A: cash-basis PAID expenses + family allocation + per-currency NET POSITION.
-- Scope is deliberately minimal — no budgets, vendors, schedules, deposits, instalments, invoicing,
-- approvals, FX conversion, or reminders. Applies cleanly on top of 0010.
--
-- Key correctness properties (per the approved spec):
--  * READS are authorised by narrowly-scoped SECURITY DEFINER helpers. The RLS policies call ONLY those
--    helpers; the helpers read the finance tables as the (definer) owner, which bypasses RLS, so the two
--    policies never query each other's RLS-protected table as the invoker => NO RLS recursion.
--  * ALLOCATIONS store a single authoritative amount (allocation_amount). The write RPCs convert any
--    percentages to 2-decimal amounts with a deterministic largest-remainder rule before persisting.
--  * A DEFERRED constraint trigger (one function, both tables) enforces that allocation amounts sum
--    EXACTLY to the expense amount at COMMIT.
--  * The aggregate is NET POSITION by host group and currency (paid - allocated). It is NOT a unique
--    who-pays-whom transfer plan; for three or more groups the settling transfers are not unique.

-- ========================= tables =========================
create table app.finance_expense (
  id                    uuid primary key default gen_random_uuid(),
  wedding_id            uuid not null references app.wedding(id) on delete cascade,
  description           text not null,
  category              text not null,
  amount                numeric(14,2) not null check (amount > 0),
  currency_code         char(3) not null check (currency_code ~ '^[A-Z]{3}$'),   -- ISO 4217
  paid_at               date not null,                                           -- actual payment date (cash basis)
  paid_by_host_group_id uuid not null,
  created_by_account_id uuid references app.account(id) on delete set null,
  note                  text,
  created_at            timestamptz not null default now(),
  unique (wedding_id, id),                                                        -- composite-FK target
  foreign key (wedding_id, paid_by_host_group_id) references app.host_group (wedding_id, id)
);

create table app.finance_expense_allocation (
  id                        uuid primary key default gen_random_uuid(),
  wedding_id                uuid not null references app.wedding(id) on delete cascade,
  expense_id                uuid not null,
  responsible_host_group_id uuid not null,
  allocation_amount         numeric(14,2) not null check (allocation_amount > 0),  -- authoritative; percents converted before persist
  unique (wedding_id, expense_id, responsible_host_group_id),                      -- one row per family per expense
  foreign key (wedding_id, expense_id)                references app.finance_expense (wedding_id, id) on delete cascade,
  foreign key (wedding_id, responsible_host_group_id) references app.host_group   (wedding_id, id)
);

create index finance_expense_wedding_idx on app.finance_expense (wedding_id);
create index finance_alloc_expense_idx   on app.finance_expense_allocation (wedding_id, expense_id);

-- ============= deferred integrity: allocations sum EXACTLY to the expense amount =============
-- ONE function serves both triggers (nothing referenced-but-missing). Keyed on the affected expense.
create or replace function app.finance_assert_balanced() returns trigger
language plpgsql set search_path = app, public as $$
declare v_wed uuid; v_exp uuid; v_amount numeric(14,2); v_sum numeric(14,2);
begin
  if tg_table_name = 'finance_expense' then
    v_wed := new.wedding_id; v_exp := new.id;
  else
    v_wed := coalesce(new.wedding_id, old.wedding_id);
    v_exp := coalesce(new.expense_id, old.expense_id);
  end if;
  select amount into v_amount from app.finance_expense where wedding_id = v_wed and id = v_exp;
  if v_amount is null then return null; end if;                       -- expense deleted (cascade) => nothing to check
  select coalesce(sum(allocation_amount), 0) into v_sum
    from app.finance_expense_allocation where wedding_id = v_wed and expense_id = v_exp;
  if v_sum <> v_amount then
    raise exception 'finance: allocations for expense % total %, must equal expense amount %', v_exp, v_sum, v_amount
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger finance_alloc_balanced
  after insert or update or delete on app.finance_expense_allocation
  deferrable initially deferred for each row execute function app.finance_assert_balanced();

create constraint trigger finance_expense_amount_balanced
  after update of amount on app.finance_expense
  deferrable initially deferred for each row execute function app.finance_assert_balanced();

-- ============= read-authorisation helpers (SECURITY DEFINER => internal reads bypass RLS => no recursion) =============
create or replace function app.finance_is_group_admin_here(p_wedding uuid, p_group uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
    where r.wedding_id = p_wedding and r.account_id = app.current_account_id()
      and r.role = 'host_group_admin' and r.host_group_id = p_group);
$$;

create or replace function app.finance_can_read_expense(p_wedding uuid, p_expense uuid) returns boolean
language plpgsql stable security definer set search_path = app, public as $$
declare v_payer uuid;
begin
  if app.is_wedding_owner(p_wedding) then return true; end if;
  select paid_by_host_group_id into v_payer from app.finance_expense where wedding_id = p_wedding and id = p_expense;
  if v_payer is null then return false; end if;
  if app.finance_is_group_admin_here(p_wedding, v_payer) then return true; end if;          -- your family paid it
  return exists (                                                                            -- your family is responsible
    select 1 from app.finance_expense_allocation a
    where a.wedding_id = p_wedding and a.expense_id = p_expense
      and app.finance_is_group_admin_here(p_wedding, a.responsible_host_group_id));
end $$;

create or replace function app.finance_can_read_allocation(p_wedding uuid, p_allocation uuid) returns boolean
language plpgsql stable security definer set search_path = app, public as $$
declare v_exp uuid; v_resp uuid; v_payer uuid;
begin
  if app.is_wedding_owner(p_wedding) then return true; end if;
  select expense_id, responsible_host_group_id into v_exp, v_resp
    from app.finance_expense_allocation where wedding_id = p_wedding and id = p_allocation;
  if v_exp is null then return false; end if;
  if app.finance_is_group_admin_here(p_wedding, v_resp) then return true; end if;            -- allocated to your family
  select paid_by_host_group_id into v_payer from app.finance_expense where wedding_id = p_wedding and id = v_exp;
  if v_payer is null then return false; end if;
  return app.finance_is_group_admin_here(p_wedding, v_payer);                                -- parent paid by your family
end $$;

-- finance viewer = owner OR any host_group_admin of the wedding (used to gate the aggregate)
create or replace function app.finance_is_viewer(p_wedding uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_member(p_wedding) and (
    app.is_wedding_owner(p_wedding) or exists (
      select 1 from app.operator_role r
      where r.wedding_id = p_wedding and r.account_id = app.current_account_id()
        and r.role = 'host_group_admin'));
$$;

-- ============= RLS: deny by default; reads via helpers only; writes via owner RPCs only =============
alter table app.finance_expense            enable row level security;
alter table app.finance_expense_allocation enable row level security;

create policy fexp_read   on app.finance_expense            for select using (app.finance_can_read_expense(wedding_id, id));
create policy falloc_read on app.finance_expense_allocation for select using (app.finance_can_read_allocation(wedding_id, id));
-- (no write policies: direct INSERT/UPDATE/DELETE is denied to app roles)

-- ============= aggregate: NET POSITION by host group and currency =============
-- SECURITY: definer/owner-rights view (NOT security_invoker) is used INTENTIONALLY so it aggregates the
-- whole wedding's rows to a complete total (a family admin cannot read them line-by-line). security_barrier
-- prevents caller predicates from being pushed below the gate. The WHERE restricts rows to the owner or a
-- finance viewer of that wedding_id; only AGGREGATE columns are exposed (never line items); currency_code is
-- always part of the grouping so different currencies are never summed together.
create view app.finance_net_position with (security_barrier = true) as
with paid as (
  select wedding_id, paid_by_host_group_id as host_group_id, currency_code, sum(amount) as paid_amount
  from app.finance_expense group by wedding_id, paid_by_host_group_id, currency_code),
alloc as (
  select e.wedding_id, a.responsible_host_group_id as host_group_id, e.currency_code,
         sum(a.allocation_amount) as allocated_amount
  from app.finance_expense_allocation a
  join app.finance_expense e on e.wedding_id = a.wedding_id and e.id = a.expense_id
  group by e.wedding_id, a.responsible_host_group_id, e.currency_code),
grp as (select wedding_id, host_group_id, currency_code from paid
        union select wedding_id, host_group_id, currency_code from alloc)
select g.wedding_id, g.host_group_id, g.currency_code,
       coalesce(p.paid_amount, 0)      as paid_amount,
       coalesce(a.allocated_amount, 0) as allocated_amount,
       coalesce(p.paid_amount, 0) - coalesce(a.allocated_amount, 0) as net_position
from grp g
left join paid  p using (wedding_id, host_group_id, currency_code)
left join alloc a using (wedding_id, host_group_id, currency_code)
where app.finance_is_viewer(g.wedding_id);

-- ============= percent-or-amount -> authoritative 2-decimal amounts (largest-remainder rounding) =============
create or replace function app.finance_resolve_allocations(p_amount numeric, p_allocations jsonb)
returns table(host_group_id uuid, amount numeric)
language plpgsql stable security definer set search_path = app, public as $$
declare n_total int; n_pct int; n_amt int; v_sum_pct numeric;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'finance: at least one allocation is required';
  end if;
  select count(*), count(*) filter (where e ? 'percent'), count(*) filter (where e ? 'amount')
    into n_total, n_pct, n_amt from jsonb_array_elements(p_allocations) e;

  if n_pct = n_total and n_amt = 0 then                                  -- percent basis -> convert to amounts
    select coalesce(sum((e->>'percent')::numeric), 0) into v_sum_pct from jsonb_array_elements(p_allocations) e;
    if round(v_sum_pct, 4) <> 100 then raise exception 'finance: percentages total %, must be 100', v_sum_pct; end if;
    return query
      with raw as (
        select (e->>'group')::uuid as g,
               round((e->>'percent')::numeric / 100.0 * p_amount, 2) as amt,
               ((e->>'percent')::numeric / 100.0 * p_amount)
                 - round((e->>'percent')::numeric / 100.0 * p_amount, 2) as rem
        from jsonb_array_elements(p_allocations) e),
      resid as (select round(p_amount - sum(amt), 2) as r from raw),
      ranked as (select g, amt, row_number() over (order by rem desc, g asc) as rn from raw)
      select r.g, (r.amt + case when r.rn = 1 then (select r from resid) else 0 end)::numeric(14,2)
      from ranked r;
  elsif n_amt = n_total and n_pct = 0 then                               -- fixed-amount basis (as given; trigger enforces the sum)
    return query select (e->>'group')::uuid, (e->>'amount')::numeric(14,2) from jsonb_array_elements(p_allocations) e;
  else
    raise exception 'finance: allocations must be all percentages or all fixed amounts, not mixed';
  end if;
end $$;

-- ============= owner-only write RPCs (SECURITY DEFINER; check is_wedding_owner) =============
create or replace function app.owner_add_expense(
  p_wedding uuid, p_description text, p_category text, p_amount numeric, p_currency text,
  p_paid_at date, p_paid_by_host_group uuid, p_note text, p_allocations jsonb
) returns uuid language plpgsql security definer set search_path = app, public as $$
declare v_exp uuid; v_amt numeric(14,2); r record;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_paid_by_host_group is null then raise exception 'a paying host group is required'; end if;
  v_amt := round(p_amount, 2);
  insert into app.finance_expense (wedding_id, description, category, amount, currency_code, paid_at,
                                   paid_by_host_group_id, created_by_account_id, note)
  values (p_wedding, trim(p_description), coalesce(nullif(trim(coalesce(p_category,'')), ''), 'misc'),
          v_amt, upper(p_currency), p_paid_at, p_paid_by_host_group,
          app.current_account_id(), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_exp;
  for r in select * from app.finance_resolve_allocations(v_amt, p_allocations) loop
    insert into app.finance_expense_allocation (wedding_id, expense_id, responsible_host_group_id, allocation_amount)
    values (p_wedding, v_exp, r.host_group_id, r.amount);
  end loop;
  return v_exp;   -- deferred trigger verifies the allocations sum to the amount at commit
end $$;

create or replace function app.owner_update_expense(
  p_wedding uuid, p_expense uuid, p_description text, p_category text, p_amount numeric, p_currency text,
  p_paid_at date, p_paid_by_host_group uuid, p_note text, p_allocations jsonb
) returns void language plpgsql security definer set search_path = app, public as $$
declare v_amt numeric(14,2); r record;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  v_amt := round(p_amount, 2);
  update app.finance_expense
     set description = trim(p_description), category = coalesce(nullif(trim(coalesce(p_category,'')), ''), 'misc'),
         amount = v_amt, currency_code = upper(p_currency), paid_at = p_paid_at,
         paid_by_host_group_id = p_paid_by_host_group, note = nullif(trim(coalesce(p_note, '')), '')
   where wedding_id = p_wedding and id = p_expense;
  if not found then raise exception 'unknown expense'; end if;
  delete from app.finance_expense_allocation where wedding_id = p_wedding and expense_id = p_expense;
  for r in select * from app.finance_resolve_allocations(v_amt, p_allocations) loop
    insert into app.finance_expense_allocation (wedding_id, expense_id, responsible_host_group_id, allocation_amount)
    values (p_wedding, p_expense, r.host_group_id, r.amount);
  end loop;
end $$;

create or replace function app.owner_delete_expense(p_wedding uuid, p_expense uuid)
returns void language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  delete from app.finance_expense where wedding_id = p_wedding and id = p_expense;   -- allocations cascade
end $$;

-- ============= grants (least privilege) =============
-- readers: SELECT on the tables (RLS scopes) + the aggregate view; the policies invoke only the *_can_read_*
-- helpers, so those are the only finance helpers the CALLER executes directly.
grant select on app.finance_expense, app.finance_expense_allocation, app.finance_net_position to authenticated;

revoke execute on function app.finance_assert_balanced()                         from public;
revoke execute on function app.finance_is_group_admin_here(uuid, uuid)           from public;
revoke execute on function app.finance_can_read_expense(uuid, uuid)              from public;
revoke execute on function app.finance_can_read_allocation(uuid, uuid)           from public;
revoke execute on function app.finance_is_viewer(uuid)                           from public;
revoke execute on function app.finance_resolve_allocations(numeric, jsonb)       from public;
grant  execute on function app.finance_can_read_expense(uuid, uuid)              to authenticated;
grant  execute on function app.finance_can_read_allocation(uuid, uuid)           to authenticated;
-- finance_is_viewer is called directly in the finance_net_position view's WHERE qual; a function invoked in
-- a view predicate has EXECUTE checked against the CALLER (unlike helpers called inside a definer function),
-- so authenticated needs it. It is SECURITY DEFINER, so it still evaluates the caller's own access.
grant  execute on function app.finance_is_viewer(uuid)                           to authenticated;

revoke execute on function app.owner_add_expense(uuid, text, text, numeric, text, date, uuid, text, jsonb)          from public, anon;
grant  execute on function app.owner_add_expense(uuid, text, text, numeric, text, date, uuid, text, jsonb)          to authenticated;
revoke execute on function app.owner_update_expense(uuid, uuid, text, text, numeric, text, date, uuid, text, jsonb) from public, anon;
grant  execute on function app.owner_update_expense(uuid, uuid, text, text, numeric, text, date, uuid, text, jsonb) to authenticated;
revoke execute on function app.owner_delete_expense(uuid, uuid)                  from public, anon;
grant  execute on function app.owner_delete_expense(uuid, uuid)                  to authenticated;
