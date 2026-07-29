# Privacy and Pilot Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining privacy leaks and first-use workflow gaps without storing family funding data or deleting production data automatically.

**Architecture:** Ship three independently reviewable changes. First quarantine all automatically converted legacy-finance rows and restrict the conversion ledger to service operators. Second make Cost Control default to estimate/approval tracking, prevent private financial details in user-entered text, and make saved drafts editable. Third complete recipient-bound invitation issuance and preserve the invite destination across OTP sign-in while keeping the exchange flag off until end-to-end certification.

**Tech Stack:** PostgreSQL 17/Supabase migrations and RLS, Next.js 15 server actions, TypeScript, Vitest, role-based SQL suites.

## Global Constraints

- Never store family contributions, balances, bank/card/account details, source of funds, payer-family attribution, or private settlement positions.
- Do not delete legacy production rows in this change; produce count-only inventory and quarantine accessible copies.
- Event managers may see official wedding costs but never family funding facts or conversion metadata.
- Every database mutation path must derive the actor from the verified session and remain deny-by-default.
- `INVITE_EXCHANGE_ENABLED` remains off until the complete browser journey passes against real Supabase Auth.
- Apply TDD: each behavior must be observed failing before production code is written.

---

### Task 1: Quarantine legacy conversions and expose count-only inventory

**Files:**
- Create: `supabase/migrations/20260729110000_0044_legacy_finance_quarantine.sql`
- Create: `supabase/tests/24_legacy_finance_quarantine.sql`
- Modify: `scripts/run-sql-suites.sh` only if suite discovery is not automatic

**Interfaces:**
- Produces `app.legacy_finance_inventory()` returning table name and row count only to `service_role`.
- Changes `legacy_cost_control_conversion.outcome='converted'` rows to `quarantined` after removing their generated `cost_item`; source legacy rows remain intact.
- Removes authenticated access and the wedding-scoped RLS policy from `legacy_cost_control_conversion`.

- [ ] **Step 1: Write the failing SQL suite**

Seed one official-looking legacy row and one unlinked row containing private funding language, invoke the existing converter, then assert that authenticated event managers can currently read converted rows and conversion metadata. The new expected state is: both generated Cost Control copies are absent, both mappings are `quarantined`, authenticated access to the mapping is denied, and `service_role` receives counts without descriptions, notes, amounts, family IDs, or contacts.

- [ ] **Step 2: Verify RED**

Run a fresh database with `DATABASE_URL=... bash scripts/run-sql-suites.sh`. Expected: suite 24 fails because generated legacy items and authenticated conversion metadata remain visible.

- [ ] **Step 3: Add the quarantine migration**

In one transaction: extend the outcome CHECK with `quarantined`; delete generated `cost_item` rows referenced by converted mappings (cascade removes generated estimates but not source legacy rows); null `cost_item_id` and set outcome to `quarantined`; drop `legacy_conversion_cost_control_read`; revoke all conversion-ledger privileges from `authenticated`; grant only `service_role` SELECT. Add a `SECURITY DEFINER` count-only inventory function with a fixed `search_path`, revoke from `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`.

- [ ] **Step 4: Verify GREEN**

Run all SQL suites against a fresh database. Expected: suites 00–24 pass, including real role switching.

- [ ] **Step 5: Commit**

Commit only the migration and SQL test as `fix: quarantine legacy private finance conversions`.

---

### Task 2: Add estimate-first privacy and editable drafts

**Files:**
- Create: `app/lib/data/costPrivacy.ts`
- Create: `app/lib/data/costPrivacy.test.ts`
- Modify: `app/lib/data/cost-control.ts`
- Modify: `app/lib/data/cost-control.test.ts`
- Modify: `app/app/host/cost-control/page.tsx`
- Modify: `app/app/host/cost-control/actions.ts`
- Create: `supabase/migrations/20260729111000_0045_cost_control_privacy.sql`
- Create: `supabase/tests/25_cost_control_privacy.sql`

**Interfaces:**
- `validateOfficialCostText(value: string): { ok: true } | { ok: false; reason: string }` rejects obvious bank-account, card-number, source-of-funds, family-contribution, and private-settlement labels while allowing ordinary vendor scope/reference text.
- `CostControlEstimate` includes the current draft fields required to populate an edit form.
- Saved draft forms submit `estimateId`; a repeated save updates the same draft instead of creating a second version.
- Invoice/payment sections are collapsed behind explicit “Official records” disclosure and state that they are optional; estimate/approval tracking remains the default journey.

- [ ] **Step 1: Write failing unit tests**

Add table-driven tests showing ordinary text such as `Stage floral installation` and `Vendor invoice INV-42` is accepted, while explicit bank account, IFSC, card number, source-of-funds, contribution, and family-settlement labels are rejected. Extend the mapper test so a draft retains `scopeIncluded`, `scopeExcluded`, `remarks`, and `decisionDue`, and add a source-contract test proving the edit form includes the draft ID.

- [ ] **Step 2: Verify unit RED**

Run `npm test -- lib/data/costPrivacy.test.ts lib/data/cost-control.test.ts`. Expected: failures for the missing validator, missing mapped fields, and missing edit form.

- [ ] **Step 3: Write failing SQL privacy tests**

As an event manager, call draft/commitment/invoice/payment RPCs with explicit prohibited private-finance labels in their text inputs. Expected future result: SQLSTATE `22023`, with no row written. Verify an ordinary vendor reference succeeds.

- [ ] **Step 4: Verify SQL RED**

Run suite 25 against a fresh database. Expected: prohibited text is currently accepted.

- [ ] **Step 5: Implement the shared application validator and draft editor**

Validate every free-text Cost Control action before RPC invocation. Map all editable draft values. Render an edit form for each draft using its `estimateId` and current values; render “Create a revised estimate” only for non-draft historical versions. Add explicit copy: “Do not enter bank details, family contributions, funding sources or private settlements.” Keep invoice/payment forms under an optional Official records disclosure.

- [ ] **Step 6: Enforce the boundary in PostgreSQL**

Add a stable helper that rejects the same explicit prohibited labels and call it from the existing Cost Control SECURITY DEFINER RPCs before writes. Keep the check narrow and deterministic; do not attempt AI classification or inspect numeric amounts. Add length constraints for all Cost Control free text modified by this task.

- [ ] **Step 7: Verify GREEN**

Run the focused unit tests, all application tests, all SQL suites, typecheck, lint, and build. Expected: zero failures and no warnings from lint/typecheck.

- [ ] **Step 8: Commit**

Commit the Cost Control privacy/draft slice as `fix: make Cost Control estimate-first and editable`.

---

### Task 3: Complete the recipient-bound invitation journey

**Files:**
- Modify: `app/app/host/manage/actions.ts`
- Modify: `app/app/host/manage/page.tsx`
- Modify: `app/app/invite/[token]/page.tsx`
- Modify: `app/app/login/actions.ts`
- Modify: `app/app/login/ResendCodeButton.tsx`
- Modify: `app/lib/auth/landing.ts`
- Modify: `app/lib/auth/landing.test.ts`
- Create: `app/lib/auth/inviteJourney.test.ts`
- Modify: `app/scripts/verify-supabase-local.mjs`
- Modify: `README.md`, `app/README.md`, `DEPLOY.md`, and `SANGAM_MANUAL.md`

**Interfaces:**
- Host issuance uses `app.issue_access_link(wedding_id, guest_id, intended_contact, ttl)` through a server-only command and returns a single raw URL only to the authorized issuing operator; the database stores only its hash.
- Signed-out invite CTA is `/login?next=${encodeURIComponent('/invite/' + token)}`.
- `sendSignInCode`, resend, error, and sent-state redirects preserve the validated `next` path.
- The feature flag remains disabled in production until the enhanced real-auth verification passes.

- [ ] **Step 1: Write failing journey tests**

Add pure/source-contract tests proving the signed-out invite page links to login with `next`, every OTP redirect retains the safe destination, unsafe external destinations fall back, and the host screen has an issuance action that accepts no account ID or wedding authority from the browser beyond the row identifiers re-authorized by the database.

- [ ] **Step 2: Verify RED**

Run the focused auth tests. Expected: the invite CTA, preserved sent-state destination, and host issuance UI are missing.

- [ ] **Step 3: Implement issuance and redirect preservation**

Add the authorized server action and host control, preserving the existing recipient-bound RPC and never logging the raw token/contact. Add a signed-out CTA on the invite page. Preserve `next` through send, resend, error, and verify redirects using `safeInternalPath`.

- [ ] **Step 4: Extend the real-auth gate**

Create a disposable Auth user/guest, issue a link, verify signed-out GET is non-consuming and no-PII, authenticate with real GoTrue, verify wrong-contact preview/redeem denial, redeem with the intended session, prove replay denial, and clean every disposable row in `finally`.

- [ ] **Step 5: Reconcile documentation**

Replace stub/old-link claims with release-state wording: code-only OTP, persistent sessions, implemented Slice-1 schedule/RSVP, invite exchange implemented but disabled until the new real-auth/browser gate is certified. Update migration and suite counts mechanically.

- [ ] **Step 6: Verify GREEN**

Run all unit tests, typecheck, lint, build, all SQL suites, and `npm run verify:supabase-local` under `supabase start`. Expected: all gates pass and the production flag remains unchanged.

- [ ] **Step 7: Commit**

Commit as `feat: complete recipient-bound guest invitations`.

---

## Release order

1. Merge and deploy Task 1 first; run the count-only inventory and review counts without revealing row contents.
2. Merge Task 2 after Task 1 is live; manually verify event-manager and cost-approver separation.
3. Merge Task 3 with `INVITE_EXCHANGE_ENABLED=0`; enable only after the complete real-auth/browser acceptance passes in the hosted environment.

## Final verification

- `DATABASE_URL=... bash scripts/run-sql-suites.sh`
- `cd app && npm test && npm run typecheck && npm run lint && npm run build`
- `supabase start && cd app && npm run verify:supabase-local`
- Production: count-only legacy inventory, manager cannot read conversion ledger, returning session bypasses OTP, signed-out invite preserves its destination, wrong contact cannot see a name or redeem, event manager cannot approve their own estimate, and no Cost Control payload contains family/funding fields.
