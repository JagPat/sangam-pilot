# Finance Privacy Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let event managers manage wedding costs while exposing only a manually published per-currency funding status and denying all access to family contributions, payer attribution, allocations, and settlement positions.

**Architecture:** Split manager-safe operational costs into `finance_cost_item`, keep the existing finance tables as the private settlement domain, and expose a deliberately non-derived `finance_funding_status` view. Authorization is capability-based through additive wedding roles; the account-level super-admin role never bypasses wedding RLS during ordinary application requests.

**Tech Stack:** PostgreSQL 17, Supabase Auth/PostgREST/RLS, Next.js 15, TypeScript, Vitest, SQL adversarial suites, GitHub Actions, Coolify.

## Global Constraints

- `jagrutpatel@gmail.com` is provisioned as the initial `platform_super_admin` by resolving the existing account row server-side; browser input never determines this role.
- Platform privilege does not bypass wedding RLS during normal use.
- Event managers see operational amounts but never contribution, balance, payer-family, allocation, or settlement data.
- Funding status is manual and separated by ISO currency: `not_assessed`, `funded`, or `funds_needed`.
- Changing operational costs never recalculates the funding signal.
- INR and USD are never combined without an explicit exchange-rate feature.
- Grants, RLS, and RPC signatures are the security boundary; React is not.
- Existing private finance rows are preserved and migrated one-to-one into operational cost items.
- Database migrations deploy before the application image.

---

### Task 1: Add platform and wedding role capabilities

**Files:**
- Create: `supabase/migrations/20260726160000_0031_finance_role_values.sql`
- Create: `supabase/migrations/20260726160100_0032_finance_role_boundary.sql`
- Create: `supabase/tests/17_finance_privacy.sql`
- Modify: `scripts/run-sql-suites.sh`

**Interfaces:**
- Produces `app.platform_role`, `app.is_platform_super_admin()`, `app.is_event_manager(uuid)`, and `app.is_finance_admin(uuid)`.
- Adds `event_manager` and `finance_admin` to `app.operator_role_kind`; both require a null `host_group_id`.

- [ ] **Step 1: Write failing role-boundary tests**

Seed owner-only, event-manager, finance-admin, host-group-admin, plain-member, and unrelated-wedding accounts. Assert the capabilities under `authenticated`:

```sql
if not app.is_event_manager(v_wedding) then raise exception 'manager capability missing'; end if;
if app.is_finance_admin(v_wedding) then raise exception 'manager became finance admin'; end if;
if not app.is_finance_admin(v_wedding) then raise exception 'finance capability missing'; end if;
if app.is_event_manager(v_other_wedding) then raise exception 'cross-wedding manager leak'; end if;
```

When an account with normalized email `jagrutpatel@gmail.com` exists, assert it receives `platform_super_admin`. Assert platform privilege alone leaves both wedding capability helpers false.

- [ ] **Step 2: Run a fresh database and verify the test fails**

```bash
dropdb --if-exists sangam_finance_privacy
createdb sangam_finance_privacy
DATABASE_URL=postgres:///sangam_finance_privacy bash scripts/run-sql-suites.sh
```

Expected: suite 17 fails because the role table and helpers do not exist.

- [ ] **Step 3: Implement migrations 0031–0032**

Migration 0031 only adds the two `operator_role_kind` enum values. Migration 0032 creates the platform role enum/table and uses the newly committed wedding-role values. This separation avoids PostgreSQL's `unsafe use of new value` failure when an enum value is added and inserted in one transaction. Replace `operator_role_group_shape` so `wedding_owner`, `event_manager`, and `finance_admin` require no host group, while `host_group_admin` and `co_host` require one.

Use stable security-definer helpers that require an active wedding membership. Revoke platform-table privileges from `anon` and `authenticated`; expose only the boolean helper. Provision server-side:

```sql
insert into app.platform_role(account_id, role)
select id, 'platform_super_admin' from app.account
where lower(email) = 'jagrutpatel@gmail.com'
on conflict do nothing;
```

Add `event_manager` for each wedding that account already owns. Runtime checks use account UUID, never request-supplied email.

- [ ] **Step 4: Re-run all SQL suites and commit**

```bash
DATABASE_URL=postgres:///sangam_finance_privacy bash scripts/run-sql-suites.sh
git add supabase/migrations/20260726160000_0031_finance_role_values.sql supabase/migrations/20260726160100_0032_finance_role_boundary.sql supabase/tests/17_finance_privacy.sql scripts/run-sql-suites.sh
git commit -m "feat: separate finance operator roles"
```

### Task 2: Add manager-safe operational costs and funding signals

**Files:**
- Create: `supabase/migrations/20260726161000_0033_operational_finance.sql`
- Modify: `supabase/tests/17_finance_privacy.sql`

**Interfaces:**
- Produces `app.finance_cost_item`, private `app.finance_funding_signal`, and manager-safe view `app.finance_funding_status`.
- Produces `manager_add_cost`, `manager_update_cost`, `manager_cancel_cost`, and `finance_admin_publish_signal` RPCs.

- [ ] **Step 1: Extend suite 17 before implementation**

Prove an event manager can add/update/cancel an operational cost and read its exact amount. Prove the manager reads only `wedding_id`, `currency_code`, `status`, and `updated_at` from the status view, cannot publish status, and cannot read the private signal table. Prove USD and INR stay separate and cost changes do not alter a published status.

- [ ] **Step 2: Run the suite and verify it fails on missing tables**

Run the fresh-database command from Task 1. Expected: failure on `finance_cost_item`.

- [ ] **Step 3: Implement operational schema and RPCs in migration 0033**

Create enums:

```sql
create type app.cost_payment_status as enum ('planned','due','part_paid','paid','cancelled');
create type app.funding_status as enum ('not_assessed','funded','funds_needed');
```

`finance_cost_item` stores wedding, optional same-wedding vendor engagement, description, category, positive amount, ISO currency, due date, payment state, paid date, operational note, creator/updater and timestamps. `finance_funding_signal` has primary key `(wedding_id,currency_code)`, status, updater and timestamp. The security-invoker view omits updater and all amounts.

Manager/finance-admin RLS permits operational reads; narrow security-definer RPCs perform writes. Active owners, managers, finance admins and host-group admins read the safe status view. Only finance admins publish status. Revoke all definer functions from `PUBLIC` and `anon`, granting only the intended authenticated entry points.

Manager updates reject amount/currency changes when a linked private settlement exists. Cancellation replaces destructive deletion.

- [ ] **Step 4: Add direct-call and cross-wedding adversarial assertions**

Call every definer function as `anon`, unrelated authenticated, owner-only, manager and finance admin. Expected: only the documented capability succeeds; unrelated-wedding reads return zero rows.

- [ ] **Step 5: Run all suites and commit**

```bash
DATABASE_URL=postgres:///sangam_finance_privacy bash scripts/run-sql-suites.sh
git add supabase/migrations/20260726161000_0033_operational_finance.sql supabase/tests/17_finance_privacy.sql
git commit -m "feat: add private funding signals and manager costs"
```

### Task 3: Make existing settlement data private and preserve it

**Files:**
- Create: `supabase/migrations/20260726162000_0034_private_finance_authorization.sql`
- Modify: `supabase/tests/08_finance.sql`
- Modify: `supabase/tests/16_group_vendors_finance.sql`
- Modify: `supabase/tests/17_finance_privacy.sql`

**Interfaces:**
- Adds nullable unique `finance_expense.cost_item_id` with a same-wedding composite FK.
- Full private access requires `finance_admin`, never `wedding_owner` or `event_manager` alone.
- Existing private RPC names remain compatible but require `finance_admin` and synchronize the linked cost item.

- [ ] **Step 1: Change tests first**

Give the existing full-view fixture both `wedding_owner` and `finance_admin`. Add owner-only and event-manager actors and assert both see zero private expense, allocation and net-position rows. Preserve existing host-group side isolation. Assert a finance admin sees the complete private ledger.

- [ ] **Step 2: Run and verify owner/manager assertions fail under current policies**

Expected: `finance_can_read_expense` still grants the owner complete access.

- [ ] **Step 3: Implement data-preserving migration 0034**

Insert one operational cost per existing private expense and link it. Copy description/category/amount/currency/paid date, but never payer group, allocations, or private note into manager-readable fields.

Update `finance_can_read_expense`, `finance_can_read_allocation`, and `finance_is_viewer` so full wedding access begins with:

```sql
if app.is_finance_admin(p_wedding) then return true; end if;
```

Preserve host-group-admin side logic. Recreate the net-position view using the new gate. Require `finance_admin` in private write RPCs. Private changes synchronize operational fields transactionally; manager RPCs cannot change private payer or allocations.

- [ ] **Step 4: Run all suites and commit**

```bash
DATABASE_URL=postgres:///sangam_finance_privacy bash scripts/run-sql-suites.sh
git add supabase/migrations/20260726162000_0034_private_finance_authorization.sql supabase/tests/08_finance.sql supabase/tests/16_group_vendors_finance.sql supabase/tests/17_finance_privacy.sql
git commit -m "fix: enforce private family finance access"
```

### Task 4: Add role-specific navigation and finance read models

**Files:**
- Create: `app/lib/data/organizerAccess.ts`
- Create: `app/lib/data/organizerAccess.test.ts`
- Create: `app/lib/data/financeOperations.ts`
- Create: `app/lib/data/financeOperations.test.ts`
- Rename: `app/lib/data/finance.ts` to `app/lib/data/privateFinance.ts`
- Modify: `app/lib/data/nav.ts`
- Modify: `app/lib/database.types.ts`
- Modify: `app/app/preview/host-nav/page.tsx`
- Modify: `app/app/preview/stay/page.tsx`

**Interfaces:**
- Produces `organizerNavForRoles(email, roles, isPlatformSuperAdmin): OrganizerNav`.
- Produces `getFinanceOperations(db): Promise<FinanceOperationsWedding[]>` with no private family properties.
- Produces `getPrivateFinanceData(db): Promise<FinanceWedding[]>` for authorized private-finance callers.

- [ ] **Step 1: Write failing role and payload tests**

```ts
const manager = organizerNavForRoles('manager@example.test', ['event_manager'], false);
expect(manager.roleLabel).toBe('Event manager');
expect(manager.sections).toContainEqual({ href: '/host/finance', label: 'Finance operations', key: 'finance' });
expect(manager.sections).not.toContainEqual(expect.objectContaining({ href: '/host/private-finance' }));

const owner = organizerNavForRoles('owner@example.test', ['wedding_owner'], false);
expect(owner.roleLabel).toBe('Wedding administrator');
expect(owner.sections).not.toContainEqual(expect.objectContaining({ key: 'private-finance' }));
```

Assert the manager cost mapping contains operational fields and lacks `hostGroup`, `contributor`, `allocation`, `balance`, and `net`.

- [ ] **Step 2: Run focused tests and verify missing modules fail**

```bash
cd app
npm test -- organizerAccess.test.ts financeOperations.test.ts
```

- [ ] **Step 3: Implement role unions and safe loaders**

Build navigation as the de-duplicated union of sections for all assigned wedding roles. Platform super-admin changes the label but grants no wedding route by itself. Event manager receives operational modules and `/host/finance`; finance admin receives `/host/finance` plus `/host/private-finance`; wedding owner receives configuration modules without private finance.

`getFinanceOperations` queries only `wedding`, `finance_cost_item`, and `finance_funding_status`. It never queries private expense, allocation, net-position, host-group, payer, or contribution relations.

- [ ] **Step 4: Update exact database types and preview labels**

Add rows, enums, views and RPC signatures for migrations 0031–0034. Replace every preview/comment that labels `wedding_owner` as event manager.

- [ ] **Step 5: Run app tests/typecheck and commit**

```bash
cd app
npm test
npm run typecheck
git add app
git commit -m "feat: add finance role-aware navigation"
```

### Task 5: Split operational and private finance screens

**Files:**
- Rewrite: `app/app/host/finance/page.tsx`
- Rewrite: `app/app/host/finance/actions.ts`
- Create: `app/app/host/finance/FinanceOperationsView.tsx`
- Create: `app/app/host/finance/FinanceOperationsView.test.tsx`
- Create: `app/app/host/private-finance/page.tsx`
- Create: `app/app/host/private-finance/actions.ts`

**Interfaces:**
- `/host/finance` consumes only `FinanceOperationsWedding`.
- `/host/private-finance` consumes `FinanceWedding` and private settlement RPCs.
- Operational server actions accept no payer, host-group, allocation, balance, contribution, or net-position input.

- [ ] **Step 1: Write failing operations UI tests**

Render an operations fixture and assert:

```ts
expect(html).toContain('INR — Funded');
expect(html).toContain('₹2,50,000');
expect(html).not.toContain('Paid by');
expect(html).not.toContain('Responsible split');
expect(html).not.toContain('Net position');
expect(html).not.toContain('Bride family');
expect(html).not.toContain('Groom family');
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
cd app
npm test -- FinanceOperationsView.test.tsx
```

- [ ] **Step 3: Implement `/host/finance` as operations-only**

The cost form contains description, category, amount, currency, due date, payment state, paid date, and operational note. It has no payer or allocation inputs. Funding cards show only status and last-updated time, with `Not assessed` as the fail-closed default.

- [ ] **Step 4: Move private settlement UI**

Move the current family split/net-position interface to `/host/private-finance`. Only finance admins receive full-wedding private data and publishing controls. Existing host-group admins continue using the side-scoped `/host/budget` experience.

- [ ] **Step 5: Add status publishing and accessible controls**

Finance-admin publishing uses a native labelled select and confirmation copy: “This status is visible to the event manager.” Server logs include identifiers and error codes but never private amounts, groups, or allocations.

- [ ] **Step 6: Run every app gate and commit**

```bash
cd app
npm audit
npm run lint
npm test
npm run typecheck
npm run build
test -s .next/BUILD_ID
git add app
git commit -m "feat: separate finance operations from family ledger"
```

### Task 6: Certify with real Supabase and deploy database-first

**Files:**
- Modify: `app/scripts/verify-supabase-local.mjs`
- Modify: `VALIDATION.md`
- Modify: `DEPLOY.md`

**Interfaces:**
- The real-auth script creates genuine GoTrue owner-only, event-manager, and finance-admin sessions.
- It proves the manager can operate costs/status reads while receiving zero private rows.

- [ ] **Step 1: Add real-auth adversarial assertions**

Use service role only for fixture setup. Sign each fixture through GoTrue. Through the manager client:

```js
await manager.schema('app').rpc('manager_add_cost', managerCost);
assertZero(await manager.schema('app').from('finance_expense').select('id'));
assertZero(await manager.schema('app').from('finance_expense_allocation').select('id'));
assertZero(await manager.schema('app').from('finance_net_position').select('wedding_id'));
assertDenied(await manager.schema('app').rpc('finance_admin_publish_signal', signal));
```

Through the finance-admin client, publish distinct INR and USD statuses. Verify the manager sees only status rows and timestamps.

- [ ] **Step 2: Run the complete local release gate**

```bash
dropdb --if-exists sangam_finance_privacy
createdb sangam_finance_privacy
DATABASE_URL=postgres:///sangam_finance_privacy bash scripts/run-sql-suites.sh
cd app
npm ci
npm audit
npm run lint
npm test
npm run typecheck
npm run build
```

- [ ] **Step 3: Update validation and deployment documentation**

Document the role matrix, manual-status side-channel rationale, the provisioning check for `jagrutpatel@gmail.com`, migration order 0031–0034, and database-first rollout/rollback constraints.

- [ ] **Step 4: Commit, publish, and wait for all GitHub gates**

```bash
git add app/scripts/verify-supabase-local.mjs VALIDATION.md DEPLOY.md
git commit -m "test: certify finance privacy boundary"
git push -u origin codex/finance-privacy-boundary
gh pr create --base main --head codex/finance-privacy-boundary --title "feat: separate manager and family finances"
gh pr checks --watch
```

Required checks: `db-gate`, `app-build`, and `supabase-real-auth` pass.

- [ ] **Step 5: Deploy database-first and verify live**

```bash
npx supabase@latest db push --dry-run
npx supabase@latest db push
npx supabase@latest db push --dry-run
```

The final dry run must say `Remote database is up to date.` Merge only after the database succeeds and wait for Coolify to deploy the merge commit.

Verify with the existing authenticated browser session:

- account label is `Platform super-admin`;
- `/host/finance` contains costs and per-currency status only;
- no payer, allocation, contribution or net-position fields appear;
- `/host/private-finance` denies access without `finance_admin`;
- Schedule, Stay and organizer routes remain healthy; and
- an unauthenticated request redirects protected routes to login.

- [ ] **Step 6: Sync local main and record evidence**

Fast-forward the clean primary checkout. Record the merge SHA, production migration status, Coolify deployment SHA, production build ID, and route smoke results in the final handoff.
