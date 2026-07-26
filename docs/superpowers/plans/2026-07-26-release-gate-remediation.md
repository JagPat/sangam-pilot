# Sangam Release-Gate Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed P1 correctness, authorization, privacy, scale, and mobile defects before any new Sangam module is started.

**Architecture:** Preserve Supabase RLS as the row-level backstop, but move compound business mutations into narrowly authorized transactional RPCs. Keep guest-facing interactions thin, deterministic, and testable; add SQL regressions for database invariants and Vitest coverage for client state/time conversion before changing production behavior.

**Tech Stack:** PostgreSQL 17/Supabase migrations and role-based SQL suites, Next.js 15 App Router, React 18, TypeScript, Vitest, Playwright, GitHub Actions.

## Global Constraints

- Keep `event_attendance` writes behind `propose_rsvp_change` -> `confirm_rsvp_change`.
- Keep `INVITE_EXCHANGE_ENABLED=0` until confirmed-email and real GoTrue/PostgREST tests pass.
- Never use the service role for guest or organizer application mutations.
- Preserve bride/groom host-group scoping and deny cross-wedding identifiers at the database boundary.
- Apply every schema change as a new migration; never edit an applied migration.
- Use red-green TDD for every behavior change.

---

### Task 1: Keep RSVP optimistic concurrency current

**Files:**
- Create: `app/app/schedule/rsvpState.ts`
- Create: `app/app/schedule/rsvpState.test.ts`
- Modify: `app/app/schedule/RsvpControl.tsx`
- Modify: `app/app/schedule/rsvp-actions.ts`
- Modify: `app/lib/commands/rsvp.ts`
- Modify: `app/lib/database.types.ts`
- Create: `supabase/migrations/20260726070000_0025_rsvp_version_result.sql`
- Modify: `supabase/tests/02_rsvp_flow.sql`

**Interfaces:** `public.confirm_rsvp_change(uuid,int)` returns `{ attendance_id uuid, row_version int }`; `confirmAction` returns the committed row version; `RsvpControl` retains it for the next change.

- [ ] Add a failing Vitest regression proving two successive confirmations use versions `N` then `N+1` and a first confirmation converts `null` to the committed non-null version.
- [ ] Add a failing SQL assertion proving confirmation returns the incremented version.
- [ ] Change the RPC wrapper and client state minimally to retain the committed version.
- [ ] Run `cd app && npm test -- rsvpState.test.ts` and the RSVP SQL suite; expect all assertions to pass.

### Task 2: Preserve travel wall time and timezone

**Files:**
- Create: `supabase/migrations/20260726071000_0026_travel_zoned_time.sql`
- Modify: `supabase/tests/12_stay_travel.sql`
- Create: `app/lib/time/travelTime.ts`
- Create: `app/lib/time/travelTime.test.ts`
- Modify: `app/app/stay/MyStayView.tsx`
- Modify: `app/app/stay/actions.ts`
- Modify: `app/lib/data/mystay.ts`
- Modify: `app/lib/data/stay.ts`
- Modify: `app/lib/database.types.ts`

**Interfaces:** `travel_detail` stores `wall_local`, `iana_timezone`, `offset_minutes`, and `at_instant`; `app.save_my_travel(...)` authorizes the acting guest/household and derives the instant in PostgreSQL.

- [ ] Add failing SQL cases for Asia/Kolkata and America/New_York wall times, including DST offset behavior.
- [ ] Add a failing Vitest round-trip proving a stored instant is rendered using its explicit IANA timezone rather than sliced as UTC.
- [ ] Add the zoned columns, validated RPC, timezone selector, and deterministic display conversion.
- [ ] Run the focused SQL and Vitest suites; expect literal wall times, offsets, and instants to match.

### Task 3: Enforce service request identity and currency integrity

**Files:**
- Create: `supabase/migrations/20260726072000_0027_service_integrity.sql`
- Modify: `supabase/tests/13_services.sql`
- Create: `app/lib/data/serviceTotals.ts`
- Create: `app/lib/data/serviceTotals.test.ts`
- Modify: `app/lib/data/services.ts`
- Modify: `app/app/host/stay/ServicesConsole.tsx`
- Modify: `app/lib/database.types.ts`

**Interfaces:** composite FKs bind service, household, guest, and wedding; a request-scope trigger enforces per-person versus per-household subjects; totals are `Record<currency,{hostCostCents,guestChargesCents}>`.

- [ ] Add failing adversarial SQL cases for cross-wedding service IDs, mismatched guest/household IDs, and wrong scope.
- [ ] Add a failing unit test proving INR and USD totals remain separate.
- [ ] Add constraints/trigger and currency-keyed aggregation/display.
- [ ] Run the service SQL suite and focused Vitest test; expect all malformed writes to fail without residue.

### Task 4: Make identity lifecycle and directory consent fail closed

**Files:**
- Create: `supabase/migrations/20260726073000_0028_identity_consent_lifecycle.sql`
- Modify: `supabase/tests/06_account_link.sql`
- Modify: `supabase/tests/04_rls_adversarial.sql`
- Modify: `app/app/host/manage/actions.ts`
- Modify: `app/app/host/manage/page.tsx`
- Modify: `app/app/directory/DirectoryView.tsx`
- Modify: `app/app/invite/[token]/page.tsx`
- Modify: `app/app/invite/[token]/actions.ts`
- Modify: `app/lib/database.types.ts`

**Interfaces:** `app.manage_guest_identity(...)` atomically updates name/contact/directory choice and unbinds stale identities; `app.revoke_membership_if_unreferenced(...)` deactivates membership only when no guest/operator/delegate/captain/guardian basis remains; invite disclosure/redemption requires `emailConfirmed`.

- [ ] Add failing SQL cases for changed-email access, deleted-guest membership, absent directory consent, and preserved operator/delegate access.
- [ ] Add failing application tests for unconfirmed invite sessions using a pure invite-eligibility guard.
- [ ] Implement atomic identity management, conditional membership revocation, explicit directory opt-in, and confirmed-email checks.
- [ ] Run account-link/adversarial SQL and app tests; expect stale access and absent consent to be denied.

### Task 5: Make compound organizer commands atomic and room-safe

**Files:**
- Create: `supabase/migrations/20260726074000_0029_atomic_organizer_commands.sql`
- Modify: `supabase/tests/10_family_admin.sql`
- Modify: `supabase/tests/11_stay_rooms.sql`
- Modify: `app/app/host/manage/actions.ts`
- Modify: `app/app/host/stay/actions.ts`
- Modify: `app/lib/database.types.ts`

**Interfaces:** transactional RPCs cover add guest/contact, invite guest, and allocate household; room/allocation and guest locks serialize capacity/double-booking checks.

- [ ] Add failing rollback tests where contact, invitation-guest, or occupant insertion fails after an earlier logical step.
- [ ] Add a two-session concurrency test or advisory-lock characterization proving competing occupant inserts cannot overfill/double-book.
- [ ] Implement the minimum RPCs and switch server actions to them.
- [ ] Run the family-admin and room suites; expect no partial rows after errors.

### Task 6: Remove the 1,000-row and guest-matrix failure mode

**Files:**
- Create: `app/lib/data/paging.ts`
- Create: `app/lib/data/paging.test.ts`
- Modify: `app/lib/data/manage.ts`
- Modify: `app/lib/data/host.ts`
- Modify: `app/app/host/manage/page.tsx`

**Interfaces:** paged fetches retrieve all rows in deterministic ID order; invitation lookup is a `Map` keyed by guest and event; UI supports server-side guest search/page parameters rather than rendering the full Cartesian matrix.

- [ ] Add failing tests for fetching 1,001+ rows and for constant-time keyed invitation lookup.
- [ ] Implement reusable paged reads and indexed joins.
- [ ] Add URL-backed guest search/page controls with a bounded page size.
- [ ] Run unit tests, typecheck, and a production build.

### Task 7: Repair mobile and accessibility contracts

**Files:**
- Modify: `app/app/GuestTopbar.tsx`
- Modify: `app/app/globals.css`
- Modify: guest and organizer forms under `app/app/stay`, `app/app/host/manage`, `app/app/host/finance`, and `app/app/host/setup`
- Create: `app/e2e/mobile-layout.spec.ts`

**Interfaces:** navigation fits 320px without document-level horizontal overflow; every visible input/select has an accessible name; destructive buttons require an explicit confirmation interaction.

- [ ] Add a failing Playwright layout assertion at 320, 375, and 468px and accessible-name assertions for representative forms.
- [ ] Implement a responsive two-row guest header/menu and explicit `id`/`htmlFor` associations.
- [ ] Run the mobile browser suite and ensure `documentElement.scrollWidth === innerWidth` at each width.

### Task 8: Replace release claims with real integration gates

**Files:**
- Create: `app/e2e/supabase-live.spec.ts`
- Create: `scripts/run-supabase-integration.sh`
- Modify: `.github/workflows/ci.yml`
- Modify: `DEPLOY.md`
- Modify: `VALIDATION.md`
- Modify: `README.md`
- Modify: `app/README.md`
- Modify: `app/next.config.mjs`
- Modify: `app/package.json`

**Interfaces:** fast psql RLS suites remain; a distinct Docker/Supabase job obtains real GoTrue sessions and calls PostgREST; deployment waits for migration/integration success; lint returns to CI.

- [ ] Add a failing integration gate covering anon denial, real authenticated schedule/RSVP, owner mutation, and service-role-only commands.
- [ ] Add linting and a deterministic clean verification command.
- [ ] Gate deployment documentation and workflow on migrations plus integration smoke tests; do not claim the psql stub covers GoTrue.
- [ ] Run `npm ci`, all Vitest/Playwright tests, typecheck, lint, build, all SQL suites, and the Supabase integration harness where Docker is available.

## Final Verification

- [ ] Run all numbered SQL suites against a clean migrated database.
- [ ] Run `cd app && npm ci && npm test && npm run typecheck && npm run lint && npm run build`.
- [ ] Run the real Supabase GoTrue/PostgREST integration harness.
- [ ] Run the production browser smoke without changing non-disposable wedding data.
- [ ] Review `git diff --check`, migration order, grants, generated types, and documentation claims.
