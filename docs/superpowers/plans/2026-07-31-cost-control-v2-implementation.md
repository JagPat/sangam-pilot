# Cost Control v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wall-of-forms Cost Control landing screen with an official-cost dashboard and decision queue, and add a staged, previewed, idempotent import of agreed official lines without reintroducing family finance.

**Architecture:** Keep the existing official Cost Control tables and workflows authoritative. Add pure TypeScript projections for dashboard/decision presentation, then add a separate database-backed import staging boundary whose only commit actor is an appointed event manager. Imported lines create draft estimates only; matched existing items never duplicate, unresolved or unconfirmed matches block the whole transaction, and retries are no-ops.

**Tech Stack:** Next.js 15 App Router, React 18 server components/actions, TypeScript, Supabase Postgres/PostgREST/RLS, Vitest, SQL adversarial suites.

## Global Constraints

- Sangam stores official estimates, approvals, commitments, invoices and recorded payment status only.
- Never store or display family ceilings, targets, opinions, affordability, contributions, funding sources, payer attribution, bank details, balances, or settlements.
- Event managers may operate Cost Control but may not approve their own work.
- Cost approvers decide and verify; they may inspect staged imports but may not mutate or commit them.
- Wedding ownership grants role appointment only and implies no Cost Control access.
- No `family_planner` enum or database role is added in this release.
- Exposure is computed per cost item as `max(approved commitment - approved estimate, 0)` and only then rolled up by centre and currency.
- Import matches are explicit and confirmed. Existing editable drafts block commit rather than being overwritten or duplicated.
- Import retries are keyed by wedding, batch import key and source-line identity.

---

### Task 1: Official-position dashboard projection

**Files:**
- Modify: `app/lib/data/cost-control.ts`
- Create: `app/lib/data/cost-control-dashboard.test.ts`
- Create: `app/app/host/cost-control/CostControlNav.tsx`
- Modify: `app/app/host/cost-control/page.tsx`
- Modify: `app/app/globals.css`

**Interfaces:**
- Produces `deriveCostControlDashboard(wedding)` with per-currency official totals, attention counts and per-centre exposure rows.
- Produces a reusable `CostControlNav` linking overview, decisions and import.

- [ ] Write failing tests proving exposure is calculated per item before centre roll-up, currencies never combine, and attention counts cover submitted/review estimates, unestimated items and received invoices.
- [ ] Run `npm test -- lib/data/cost-control-dashboard.test.ts` and confirm the missing projection fails.
- [ ] Implement the minimal projection and add any missing official fields to the loader.
- [ ] Redesign `/host/cost-control` around official position, needs-attention and centre exposure while retaining the operational item forms below.
- [ ] Run the focused tests, typecheck and lint.

### Task 2: Context-rich decision queue

**Files:**
- Modify: `app/lib/data/cost-control.ts`
- Create: `app/lib/data/cost-control-decisions.test.ts`
- Create: `app/app/host/cost-control/decisions/page.tsx`
- Create: `app/app/host/cost-control/decisions/DecisionCard.tsx`
- Modify: `app/app/host/cost-control/page.tsx`

**Interfaces:**
- Produces `deriveDecisionQueue(wedding)` with current proposal, previous version, previous approved version, included/excluded scope and item-level official exposure.
- Reuses the existing `beginEstimateReview` and `decideEstimate` server actions.

- [ ] Write failing tests for first approval, revised proposal, prior approved comparison and item-level exposure.
- [ ] Run the focused test and confirm the missing queue fails.
- [ ] Implement the pure queue projection.
- [ ] Add role-specific event-manager and cost-approver decision screens; only cost approvers receive decision controls.
- [ ] Remove duplicate approval controls from the overview while retaining estimate editing/submission there.
- [ ] Run focused tests, typecheck and lint.

### Task 3: Staged official-line import database boundary

**Files:**
- Create: `supabase/migrations/20260731120000_0052_cost_import_staging.sql`
- Create: `supabase/tests/29_cost_import_staging.sql`
- Modify: `app/lib/database.types.ts`

**Interfaces:**
- Tables: `app.cost_import_batch`, `app.cost_import_line`.
- RPCs: `app.stage_cost_import`, `app.confirm_cost_import_matches`, `app.resolve_cost_import_line`, `app.commit_cost_import`.
- Views are unnecessary; authorized reads use invoker RLS on the staging tables.

- [ ] Write the adversarial SQL suite first. It must prove unrelated users and wedding owners see zero rows, cost approvers read but cannot mutate, event managers stage/resolve/confirm/commit, private labels are rejected, cross-wedding IDs are rejected, unresolved/unconfirmed/existing-draft lines block atomically, matched lines add only a draft estimate, unmatched lines create item plus draft, and a retry writes nothing.
- [ ] Run the suite against the pre-migration database and confirm failure because the staging objects do not exist.
- [ ] Add same-wedding composite foreign keys, RLS, grants and narrow SECURITY DEFINER RPCs.
- [ ] Make commit lock the batch and target items, validate the entire batch before writing, and record committed item/estimate IDs on each line in the same transaction.
- [ ] Add the hand-written TypeScript database shapes and RPC signatures.
- [ ] Run all SQL suites against Supabase local.

### Task 4: Import parser, preview and operator workflow

**Files:**
- Create: `app/lib/data/cost-import.ts`
- Create: `app/lib/data/cost-import.test.ts`
- Create: `app/app/host/cost-control/import/page.tsx`
- Create: `app/app/host/cost-control/import/actions.ts`
- Create: `app/app/host/cost-control/import/ImportPreview.tsx`
- Modify: `app/app/globals.css`

**Interfaces:**
- `parseCostImportCsv(text)` accepts the documented CSV columns and returns normalized rows plus validation errors.
- The page loads batches/lines under RLS and renders mutation controls only when `isEventManager`.
- Server actions call the four staging RPCs and derive actor identity from the verified session.

- [ ] Write failing parser tests for quoted fields, INR/USD separation, duplicate source IDs, invalid amounts/tax and prohibited private-finance text.
- [ ] Run the focused test and confirm failure because the parser is absent.
- [ ] Implement the minimal dependency-free CSV parser and validation.
- [ ] Add event-manager upload/paste staging, unresolved-line mapping, match confirmation and atomic commit controls.
- [ ] Render the same preview read-only for cost approvers with computed—not hard-coded—line/write counts.
- [ ] Add explicit copy that imports create drafts and never submit estimates.
- [ ] Run focused tests, all unit tests, typecheck and lint.

### Task 5: Documentation and release certification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-28-wedding-cost-control-design.md`
- Modify: `supabase/tests/README.md`

**Interfaces:**
- Documents CSV columns, role boundary, migration order and deployment gates.

- [ ] Document the dashboard/decisions/import routes and exact CSV contract.
- [ ] Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Run every SQL suite against `supabase start` with real auth roles.
- [ ] Review the final diff against every Global Constraint and scan for prohibited family-finance fields/copy.
- [ ] Request an independent code review, fix all critical/important findings, and repeat the verification gates.
- [ ] Commit, push `codex/cost-control-v2`, open a PR to `main`, wait for checks, merge, deploy migrations, and verify `https://sangam.vitan.in`.
