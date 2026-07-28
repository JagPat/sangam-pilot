# Wedding Cost Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sangam's funding/private-finance surfaces with a wedding-scoped official cost lifecycle covering estimate, approval, commitment, invoice, payment status, variance, and audit.

**Architecture:** Extend the existing wedding/event/vendor boundaries but introduce new normalized Cost Control tables instead of expanding the legacy `finance_cost_item`. Use immutable estimate versions and append-only decisions, narrow authenticated RPCs, composite same-wedding foreign keys, and invoker-security dashboard views. Convert only official legacy cost facts; never migrate payer-family, contribution, funding, allocation, balance, or settlement data.

**Tech Stack:** PostgreSQL 16/Supabase RLS, Next.js 15 server components/actions, TypeScript, Vitest, real-auth Supabase gate, Playwright live smoke.

## Global Constraints

- Complete `2026-07-28-event-manager-onboarding-remediation.md` first.
- The product label is `Cost Control`; no new UI uses `Finance`, `funded`, or `funds needed`.
- Store official vendor/wedding costs only; never store personal or family financial data.
- `host_group_id` must not appear in Cost Control tables or payloads.
- `event_manager` may submit estimates and proposals but may not approve its own submission.
- `cost_approver` is wedding-scoped and does not follow from ownership or event management.
- Keep INR and USD totals separate; no implicit exchange rate.
- Every table and cross-reference carries/enforces `wedding_id`.
- Every definer function revokes execution from `PUBLIC` and receives explicit grants.
- Do not drop legacy production rows until the conversion report is reviewed.

---

## File map

- Create migrations `0037` through `0040` for roles/schema, workflow commands, legacy conversion/access shutdown, and final retirement.
- Create SQL suites `19_cost_control_schema.sql`, `20_cost_control_workflow.sql`, and `21_cost_control_privacy.sql`.
- Create `app/lib/data/cost-control.ts`, `cost-control-mappers.ts`, and focused tests.
- Create `/host/cost-control` dashboard, item detail, estimate forms/actions, decision queue/actions, and tests.
- Modify role assignment/navigation/database types.
- Remove legacy `/host/costs`, `/host/finance`, and `/host/budget` application access after conversion.
- Create `scripts/report-legacy-finance.sql` and `app/scripts/verify-cost-control.mjs`.
- Update validation/deployment documentation.

---

### Task 1: Cost approver role and cost hierarchy

**Files:**
- Create: `supabase/migrations/20260728121000_0037_cost_control_foundation.sql`
- Create: `supabase/tests/19_cost_control_schema.sql`
- Modify: `supabase/migrations` only through the new forward migration; never edit deployed files 0031–0035.

**Interfaces:**
- Produces: `app.cost_approver` role value and `app.is_cost_approver(uuid)`
- Produces: `app.cost_centre`, `app.cost_item`, and standard template command

- [ ] **Step 1: Write schema and cross-wedding failure tests**

Test two weddings and assert a centre parent, event instance, vendor engagement, or cost item from wedding B cannot be attached to wedding A. Assert no Cost Control relation contains `host_group_id`, `contribution`, `funding`, `balance`, or `bank` columns.

- [ ] **Step 2: Run the SQL suites and verify they fail**

```bash
dropdb --if-exists sangam_cost_foundation
createdb sangam_cost_foundation
DATABASE_URL=postgres:///sangam_cost_foundation bash scripts/run-sql-suites.sh
```

- [ ] **Step 3: Add role and hierarchy types/tables**

Use forward-safe enum additions and these core shapes:

```sql
alter type app.operator_role_kind add value if not exists 'cost_approver';

create table app.cost_centre(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  parent_id uuid,
  template_key text,
  name text not null check(length(trim(name))>0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(wedding_id,id),
  foreign key(wedding_id,parent_id) references app.cost_centre(wedding_id,id)
);

create table app.cost_item(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  cost_centre_id uuid not null,
  event_instance_id uuid,
  engagement_id uuid,
  title text not null check(length(trim(title))>0),
  description text,
  lifecycle_state text not null check(lifecycle_state in ('planning','approved','committed','invoiced','closed','cancelled')),
  decision_owner_account_id uuid references app.account(id),
  decision_due_at timestamptz,
  created_by_account_id uuid not null references app.account(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(wedding_id,id),
  foreign key(wedding_id,cost_centre_id) references app.cost_centre(wedding_id,id),
  foreign key(wedding_id,event_instance_id) references app.event_instance(wedding_id,id),
  foreign key(wedding_id,engagement_id) references app.engagement(wedding_id,id)
);
```

Add deny-by-default RLS and read policies for active `event_manager` or `cost_approver` membership. Grant no direct insert/update/delete.

- [ ] **Step 4: Add the idempotent standard wedding template command**

`app.initialize_cost_control(p_wedding uuid)` checks event-manager or cost-approver authority, inserts the approved template keys/names with `on conflict do nothing`, and returns the number created. Do not include ceilings or funding amounts.

- [ ] **Step 5: Update operator-role shape and assignment RPC**

Allow `cost_approver` only with `host_group_id is null`. Replace `finance_admin` in the role-assignment UI/RPC contract for new assignments; legacy role migration occurs in Task 5.

- [ ] **Step 6: Run all SQL suites and commit**

```bash
DATABASE_URL=postgres:///sangam_cost_foundation bash scripts/run-sql-suites.sh
git add supabase/migrations/20260728121000_0037_cost_control_foundation.sql supabase/tests/19_cost_control_schema.sql
git commit -m "feat: add wedding cost control foundation"
```

---

### Task 2: Immutable estimate and approval workflow

**Files:**
- Create: `supabase/migrations/20260728122000_0038_cost_estimate_workflow.sql`
- Create: `supabase/tests/20_cost_control_workflow.sql`

**Interfaces:**
- Produces: `app.cost_estimate_version`, `app.cost_decision`
- Produces RPCs: `create_cost_item`, `save_cost_estimate_draft`, `submit_cost_estimate`, `begin_cost_review`, `decide_cost_estimate`

- [ ] **Step 1: Write failing state-machine tests**

Cover draft edit, submit freeze, revision creating a new version, stale decision rejection, manager self-approval denial, approver approval, one current approved version, calculated GST/total, and cross-wedding denial.

- [ ] **Step 2: Add immutable version and decision tables**

```sql
create type app.cost_estimate_state as enum
  ('draft','submitted','under_review','revision_required','rejected','approved','superseded');
create type app.cost_estimate_origin as enum
  ('event_manager_submission','approver_entry','import','legacy_import');

create table app.cost_estimate_version(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  cost_item_id uuid not null,
  version_number integer not null check(version_number>0),
  origin app.cost_estimate_origin not null,
  scope_included text,
  scope_excluded text,
  quantity numeric(14,3) check(quantity is null or quantity>0),
  unit text,
  unit_rate numeric(14,2) check(unit_rate is null or unit_rate>=0),
  subtotal numeric(14,2) not null check(subtotal>=0),
  tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(14,2) generated always as (round(subtotal*tax_rate/100,2)) stored,
  total numeric(14,2) generated always as (round(subtotal+(subtotal*tax_rate/100),2)) stored,
  currency_code char(3) not null check(currency_code ~ '^[A-Z]{3}$'),
  suggested_engagement_id uuid,
  alternative text,
  saving_proposal text,
  dependency text,
  remarks text,
  decision_due_at timestamptz,
  state app.cost_estimate_state not null default 'draft',
  created_by_account_id uuid not null references app.account(id),
  submitted_by_account_id uuid references app.account(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique(wedding_id,id),
  unique(wedding_id,cost_item_id,version_number),
  foreign key(wedding_id,cost_item_id) references app.cost_item(wedding_id,id),
  foreign key(wedding_id,suggested_engagement_id) references app.engagement(wedding_id,id)
);
```

Add a partial unique index for the current approved version and an append-only `cost_decision` table carrying actor, previous/resulting state, reason, and timestamp.

- [ ] **Step 3: Implement narrow workflow RPCs**

All RPCs derive `current_account_id()`. Draft-save updates only a draft owned by the actor; submit freezes it; review/decision requires `is_cost_approver`; decision rejects `actor = submitted_by_account_id`; revision creates no mutable copy automatically—the event manager explicitly starts the next version from the prior one through `save_cost_estimate_draft`.

- [ ] **Step 4: Deny direct workflow DML**

Grant authenticated users read under RLS and execute only on the public workflow functions. Revoke base-table DML and every internal helper from `PUBLIC`, `anon`, and `authenticated`.

- [ ] **Step 5: Run and commit**

```bash
dropdb --if-exists sangam_cost_workflow
createdb sangam_cost_workflow
DATABASE_URL=postgres:///sangam_cost_workflow bash scripts/run-sql-suites.sh
git add supabase/migrations/20260728122000_0038_cost_estimate_workflow.sql supabase/tests/20_cost_control_workflow.sql
git commit -m "feat: add estimate approval workflow"
```

---

### Task 3: Commitment, invoice, payment, and dashboard views

**Files:**
- Create: `supabase/migrations/20260728123000_0039_cost_actuals_dashboard.sql`
- Create: `supabase/tests/21_cost_control_privacy.sql`

**Interfaces:**
- Produces: `cost_commitment`, `cost_invoice`, `cost_payment`
- Produces: `cost_control_summary`, `cost_control_attention`
- Produces proposal/approval and invoice/payment RPCs

- [ ] **Step 1: Write failing financial-privacy and arithmetic tests**

Assert only official vendor fields exist; no payer family/source-of-funds field exists; payment total cannot exceed a non-void invoice without an approver override decision; manager may propose but not approve a commitment; summary views remain per currency and respect RLS.

- [ ] **Step 2: Create normalized official-cost tables**

Use same-wedding composite foreign keys. `cost_commitment` links an approved estimate, `cost_invoice` links an optional approved commitment, and `cost_payment` links a verified invoice. Store payment method category/reference only; never bank/card/account details.

- [ ] **Step 3: Implement mutation commands**

Provide `propose_cost_commitment`, `decide_cost_commitment`, `record_cost_invoice`, `verify_cost_invoice`, `record_cost_payment`, and `void_cost_payment`. Manager proposal paths and approver decision paths are separate. Every correction requires a reason and appends an audit/decision row.

- [ ] **Step 4: Add invoker-security views**

`cost_control_summary` groups by wedding/currency and derives submitted, approved, committed, invoiced, paid, outstanding, and approved-variance totals. `cost_control_attention` returns overdue decisions, payments due within 15 days, and largest variances. Both use `security_invoker=true` and never combine currencies.

- [ ] **Step 5: Run and commit**

```bash
dropdb --if-exists sangam_cost_actuals
createdb sangam_cost_actuals
DATABASE_URL=postgres:///sangam_cost_actuals bash scripts/run-sql-suites.sh
git add supabase/migrations/20260728123000_0039_cost_actuals_dashboard.sql supabase/tests/21_cost_control_privacy.sql
git commit -m "feat: track official commitments invoices and payments"
```

---

### Task 4: Cost Control application slice

**Files:**
- Create: `app/lib/data/cost-control.ts`
- Create: `app/lib/data/cost-control-mappers.ts`
- Create tests beside both files
- Create: `app/app/host/cost-control/page.tsx`
- Create: `app/app/host/cost-control/actions.ts`
- Create: `app/app/host/cost-control/[itemId]/page.tsx`
- Create: `app/app/host/cost-control/[itemId]/actions.ts`
- Create component tests under the route
- Modify: `app/lib/data/nav.ts` and `.test.ts`
- Modify: `app/lib/database.types.ts`

**Interfaces:**
- Consumes the schema/RPC/view contract from Tasks 1–3.
- Produces the event-manager workspace and approver queue.

- [ ] **Step 1: Write mapper and role-view tests**

Fixtures must prove the event-manager payload includes official amounts/statuses but no host group, funding, balance, contribution, or allocation key. Assert manager UI has Submit/Revise but no Approve; approver UI has decision controls and mandatory reasons.

- [ ] **Step 2: Implement the typed read model**

Return a `CostControlWedding` containing centres, items, current estimate, approved estimate, commitment, invoice/payment rollups, summary by currency, and attention rows. Keep DB calls user-scoped; RLS remains the boundary.

- [ ] **Step 3: Implement server actions through RPCs only**

Normalize form strings/numbers, call the narrow RPC, map known SQLSTATE conflicts/authorization errors to stable UI codes, revalidate `/host/cost-control` and the item page, and never pass actor/role/authority fields.

- [ ] **Step 4: Build the dashboard and item workflow**

Dashboard cards: Awaiting decisions, Approved estimates, Committed, Invoiced, Paid, Outstanding. Render one row per currency. Add hierarchy/event/vendor filters, due-soon list, and variance list. The item page presents immutable version history and the next valid action only.

- [ ] **Step 5: Replace navigation labels**

Both event managers and cost approvers see `Cost Control`; users with both roles see one destination. Remove `Private finance`, `Finance & vendors`, and funding terminology from active navigation.

- [ ] **Step 6: Verify and commit**

```bash
cd app
npm test
npm run typecheck
npm run build
git add app/lib/data/cost-control* app/app/host/cost-control app/lib/data/nav.ts app/lib/data/nav.test.ts app/lib/database.types.ts
git commit -m "feat: add wedding cost control workspace"
```

---

### Task 5: Convert official legacy facts and disable sensitive surfaces

**Files:**
- Create: `scripts/report-legacy-finance.sql`
- Create: `supabase/migrations/20260728124000_0040_cost_control_legacy_transition.sql`
- Modify/remove: `app/app/host/costs`, `app/app/host/finance`, `app/app/host/budget`
- Modify/remove: `app/lib/data/finance-operations.ts`, `finance.ts`, `family-finance.ts`
- Modify: related tests and `database.types.ts`

**Interfaces:**
- Produces an operator-reviewed row-count/conversion report.
- Removes all application/grant access to funding and private family finance.

- [ ] **Step 1: Run the read-only inventory report before migration**

Report counts and distinct weddings/currencies for `finance_cost_item`, `finance_expense`, `finance_expense_allocation`, `finance_funding_signal`, and rows with official vendor references. Do not print notes, contributor identities, payer groups, or account data.

- [ ] **Step 2: Write conversion tests**

Assert legacy planned/due costs become `legacy_import` estimates; paid official vendor costs become verified invoices/payments; payer-family/allocation/funding fields are not copied; conversion is idempotent.

- [ ] **Step 3: Implement the forward conversion and immediate access shutdown**

Copy only description/category/official amount/currency/due/payment/vendor facts. Revoke all authenticated execution/select paths to `finance_funding_signal`, private finance tables/views, and legacy RPCs. Keep the source tables sealed for the reviewed deletion step.

- [ ] **Step 4: Remove legacy application routes and data loaders**

Redirect old bookmarks to `/host/cost-control` only after the new access check succeeds; otherwise return the normal access-denied page. Delete legacy mutation actions so no build artifact can call retired RPCs.

- [ ] **Step 5: Run privacy scans and full gates**

```bash
rg -n "funds_needed|Funding status|Private finance|paid_by_host_group|finance_net_position" app/app app/lib
dropdb --if-exists sangam_cost_transition
createdb sangam_cost_transition
DATABASE_URL=postgres:///sangam_cost_transition bash scripts/run-sql-suites.sh
cd app && npm test && npm run typecheck && npm run build
```

Expected: source scan returns no active route/data-layer use; all gates pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/report-legacy-finance.sql supabase/migrations/20260728124000_0040_cost_control_legacy_transition.sql app
git commit -m "refactor: retire family finance from Sangam"
```

---

### Task 6: Real-auth certification and production rollout

**Files:**
- Create: `app/scripts/verify-cost-control.mjs`
- Modify: `app/package.json`, `app/README.md`, `VALIDATION.md`, `DEPLOY.md`

- [ ] **Step 1: Build the real-auth adversarial script**

Create disposable creator/manager/approver/unrelated users. Verify creator onboarding, manager submit, manager self-approval denial, approver decision, immutable history, cross-wedding denial, invoker-view isolation, and absence of legacy finance access. Cleanup all disposable data in `finally`.

- [ ] **Step 2: Run local Supabase and application gates**

```bash
npx supabase@latest start
npx supabase@latest db reset
eval "$(npx supabase@latest status -o env)"
cd app
npm ci
npm run verify:event-manager-onboarding
node scripts/verify-cost-control.mjs
npm test
npm run typecheck
npm run build
```

- [ ] **Step 3: Review the production inventory report**

Run `scripts/report-legacy-finance.sql` read-only against the linked production project. Confirm every official row's conversion disposition before authorizing source-table deletion. Keep the sealed source tables if any mapping remains unresolved.

- [ ] **Step 4: Deploy database then application**

Push migrations 0037–0040, verify remote migration order, deploy the matching application SHA through Coolify, and confirm the live SHA.

- [ ] **Step 5: Perform live role smokes**

Confirm an event manager can create/revise/submit but cannot decide; a cost approver can decide; both see correct per-currency official totals; unrelated/family users receive no rows; old finance URLs expose no private data.

- [ ] **Step 6: Record and commit evidence**

Record migration versions, deployed SHA, test time, sanitized fixture identifiers, and outcomes. Never record OTPs, cookies, tokens, bank data, or private legacy contents.

```bash
git add app/scripts/verify-cost-control.mjs app/package.json app/package-lock.json app/README.md VALIDATION.md DEPLOY.md
git commit -m "test: certify wedding cost control release"
```
