# Room Allocation and Controlled Sheet Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace household-owned hotel assignments with explicit, auditable per-guest room plans and add owner-controlled Google Sheets export, staging, preview, conflict rejection, and commit.

**Architecture:** Sangam remains authoritative. PostgreSQL commands own every multi-row room mutation and enforce occupancy, side visibility, audit, and optimistic concurrency. The Next.js server reads and writes Google Sheets through an adapter; Sheet edits are normalized into wedding-scoped staging records and cannot reach operational room tables until an authenticated wedding owner commits a validated batch.

**Tech Stack:** PostgreSQL 16/Supabase Auth and RLS, Next.js 15 server actions, TypeScript, Vitest, Google Sheets API through a server-only adapter, SQL adversarial suites.

## Global Constraints

- Start from current `origin/main`; add migrations after `20260729113000_0047_server_invite_issuance.sql` and never edit historical migrations.
- Sangam is the source of truth; never use last-write-wins.
- Default occupancy is double; triple is explicit; confirmed single occupancy requires a nonblank exception reason.
- Never infer or automatically create roommate groups.
- `room_occupant` is canonical; `primary_household_id` is display/coordination metadata only.
- All room/allocation/occupant mutations use transactional commands; authenticated direct DML is revoked.
- A Sheet row is update-only in the pilot. It cannot create/delete rooms or allocations.
- Google credentials remain in deployment secrets and are never stored in PostgreSQL, Apps Script, or browser code.
- Event managers cannot configure, preview, or commit Sheet synchronization in the pilot.
- Family admins see operational room facts for allocations containing their side, but only their own side's guest identities.
- Property dates are ISO `YYYY-MM-DD` local dates; the pilot workbook timezone is `Asia/Kolkata`.

---

### Task 1: Lock the corrected design contract

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-room-allocation-sheet-sync-design.md`
- Modify: `SANGAM_MANUAL.md`

**Interfaces:**
- Consumes: approved review findings from the design review.
- Produces: exact active-status, visibility, sync-revision, Sheet-update, and guest-accommodation rules used by every later task.

- [ ] **Step 1: Amend the specification**

Add explicit rules: active means `held|confirmed|checked_in`; every room mutation goes through a command; sharing confirmation is invalidated by material changes; family-side allocation visibility derives from occupants; Sheet rows are update-only; `sync_revision` covers room, allocation, and occupants; unallocated guests come from explicit guest-level stay requirements.

- [ ] **Step 2: Correct workbook guidance in the manual**

Replace any statement that a household necessarily shares one room with: “Households organize invitations and contacts; room assignments are per guest and a household may use several rooms.”

- [ ] **Step 3: Verify terminology**

Run: `rg -n "one room|household.*room|row_version|active" docs/superpowers/specs/2026-07-30-room-allocation-sheet-sync-design.md SANGAM_MANUAL.md`

Expected: no text identifies household membership as room membership; `sync_revision` and the active-status set are explicit.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-room-allocation-sheet-sync-design.md SANGAM_MANUAL.md
git commit -m "docs: lock room allocation safety rules"
```

### Task 2: Add compatibility-safe room schema

**Files:**
- Create: `supabase/migrations/20260730120000_0048_room_allocation_model.sql`
- Modify: `supabase/tests/11_stay_rooms.sql`

**Interfaces:**
- Consumes: existing `app.hotel`, `app.room`, `app.room_allocation`, `app.room_occupant`, `app.stay_request`.
- Produces: `property_kind`, `property_status`, `provisional_code`, `physical_room_number`, `inventory_status`, `occupancy_plan`, confirmation fields, `sync_revision`, and `app.stay_request_guest`.

- [ ] **Step 1: Write failing SQL cases**

Add cases proving: a household can have two active allocations; duplicate normalized provisional codes fail; duplicate nonblank physical numbers fail only within one property; a named guest can be marked as requiring accommodation; cross-wedding request/guest pairs fail.

- [ ] **Step 2: Run the stay suite and verify RED**

Run: `./scripts/run-sql-suites.sh supabase/tests/11_stay_rooms.sql`

Expected: FAIL because the new columns/table do not exist and `household_one_active_alloc` still rejects the second allocation.

- [ ] **Step 3: Add schema types and columns**

Create enums `app.property_kind`, `app.property_status`, `app.room_inventory_status`, and `app.occupancy_plan`. Add compatibility columns without dropping `room.label` or `room_allocation.household_id` in this migration.

- [ ] **Step 4: Perform collision-safe backfill**

Populate `provisional_code` deterministically with an uppercase property prefix plus a per-wedding sequence when normalized legacy labels collide. Store legacy labels unchanged when unique. Add unique indexes on `(wedding_id, lower(trim(provisional_code)))` and `(wedding_id, hotel_id, lower(trim(physical_room_number))) where physical_room_number is not null and trim(physical_room_number) <> ''`.

- [ ] **Step 5: Add explicit stay-required guests**

Create `app.stay_request_guest(wedding_id, stay_request_id, guest_id, created_at)` with composite foreign keys to the same wedding, a unique `(wedding_id, stay_request_id, guest_id)`, owner/guest-proxy policies aligned with `stay_request`, and authenticated privileges required by those policies.

- [ ] **Step 6: Remove household allocation uniqueness safely**

Drop `household_one_active_alloc`; add nullable `primary_household_id`, backfill it from `household_id`, and retain the legacy column temporarily for compatibility. Do not make either household column authoritative.

- [ ] **Step 7: Run SQL and verify GREEN**

Run: `./scripts/run-sql-suites.sh supabase/tests/11_stay_rooms.sql`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260730120000_0048_room_allocation_model.sql supabase/tests/11_stay_rooms.sql
git commit -m "feat(db): add explicit room allocation model"
```

### Task 3: Enforce the atomic room command boundary

**Files:**
- Create: `supabase/migrations/20260730121000_0049_room_allocation_commands.sql`
- Modify: `supabase/tests/11_stay_rooms.sql`
- Modify: `supabase/tests/14_stay_oversight.sql`
- Modify: `supabase/tests/04_rls_adversarial.sql`

**Interfaces:**
- Produces: `owner_create_room_draft`, `owner_update_room_identity`, `owner_save_room_allocation_draft`, `owner_confirm_room_allocation`, `owner_cancel_room_allocation`.
- Each mutation accepts wedding-scoped UUIDs and `p_expected_sync_revision bigint`; stale commands raise a dedicated SQLSTATE and change nothing.

- [ ] **Step 1: Write failing command and adversarial tests**

Test exact single/double/triple counts, required single reason, capacity, cross-wedding UUID attacks, duplicate guest assignment, stale revision, confirmation invalidation after a draft edit, rollback on any failed occupant, direct authenticated DML denial, and removal of `owner_allocate_household` execution.

- [ ] **Step 2: Verify RED**

Run: `./scripts/run-sql-suites.sh supabase/tests/11_stay_rooms.sql supabase/tests/14_stay_oversight.sql supabase/tests/04_rls_adversarial.sql`

Expected: FAIL because the commands do not exist and direct DML is still permitted.

- [ ] **Step 3: Implement command helpers and locking**

Lock the wedding, allocation, room, selected guests, and relevant occupant rows in stable UUID order. Every update compares `sync_revision`; every material edit increments it and clears `sharing_confirmed_at/by`. Confirmation writes exact occupants, validates the plan, records the current actor, increments the revision, and inserts a structured `stay_activity` entry in the same transaction.

- [ ] **Step 4: Enforce capacity reduction and active semantics**

Reject room-capacity reduction below active occupants. Replace `status <> 'cancelled'` checks with `status in ('held','confirmed','checked_in')`. Treat `checked_out` and `cancelled` as inactive.

- [ ] **Step 5: Replace grants and policies**

Revoke authenticated insert/update/delete on room tables. Grant execute only on the owner commands. Remove execute on `owner_allocate_household`. Keep service-role operations explicit rather than inheriting PUBLIC execution.

- [ ] **Step 6: Replace household-based family oversight**

An allocation is visible to a side admin when an active occupant is administrable by that side. Room-occupant rows remain side-scoped, so another side's guest identity is not disclosed.

- [ ] **Step 7: Verify GREEN**

Run: `./scripts/run-sql-suites.sh supabase/tests/11_stay_rooms.sql supabase/tests/14_stay_oversight.sql supabase/tests/04_rls_adversarial.sql`

Expected: PASS under authenticated/anon/service-role lanes.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260730121000_0049_room_allocation_commands.sql supabase/tests/11_stay_rooms.sql supabase/tests/14_stay_oversight.sql supabase/tests/04_rls_adversarial.sql
git commit -m "feat(db): enforce atomic room planning commands"
```

### Task 4: Build authoritative room summaries and exception views

**Files:**
- Create: `supabase/migrations/20260730122000_0050_room_allocation_views.sql`
- Modify: `supabase/tests/11_stay_rooms.sql`

**Interfaces:**
- Produces security-invoker views: `room_plan`, `room_plan_summary`, `room_plan_exception`, `unallocated_stay_guest`.

- [ ] **Step 1: Write failing view assertions**

Seed confirmed/draft/single/double/triple rooms across two properties and assert counts, missing physical numbers, underfilled drafts, stale confirmations, TBD property warnings, and explicitly required unallocated guests.

- [ ] **Step 2: Verify RED**

Run: `./scripts/run-sql-suites.sh supabase/tests/11_stay_rooms.sql`

Expected: FAIL because the views do not exist.

- [ ] **Step 3: Implement security-invoker views**

Calculate “rooms required” from confirmed allocations, not inventory. Calculate unallocated guests from `stay_request_guest` minus active confirmed occupants. Expose stable IDs and structured exception codes; do not expose cross-side guest names through aggregate views.

- [ ] **Step 4: Verify GREEN and cross-wedding isolation**

Run: `./scripts/run-sql-suites.sh supabase/tests/11_stay_rooms.sql supabase/tests/04_rls_adversarial.sql`

Expected: PASS; unrelated accounts see no rows.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260730122000_0050_room_allocation_views.sql supabase/tests/11_stay_rooms.sql
git commit -m "feat(db): add room plan summaries and exceptions"
```

### Task 5: Migrate the Stay read model and organizer UI

**Files:**
- Create: `app/lib/data/room-plan.ts`
- Create: `app/lib/data/room-plan.test.ts`
- Modify: `app/app/host/stay/actions.ts`
- Modify: `app/app/host/stay/StayView.tsx`
- Modify: `app/lib/data/stay.ts`
- Modify: `app/lib/database.types.ts`

**Interfaces:**
- Produces TypeScript `RoomPlanRow`, `RoomPlanSummary`, `RoomPlanException`, and owner server actions backed only by the new commands.

- [ ] **Step 1: Write failing pure-logic tests**

Test display identity (`physical ?? provisional`), explicit single/double/triple labels, warning grouping, cross-household indicators, and stale-command error copy.

- [ ] **Step 2: Verify RED**

Run: `npm test -- lib/data/room-plan.test.ts`

Expected: FAIL because `room-plan.ts` does not exist.

- [ ] **Step 3: Implement the room-plan mapper**

Map structured view rows without inferring household room membership. Preserve IDs and sync revisions in action payloads.

- [ ] **Step 4: Replace Stay writes**

Remove direct table mutations and `allocateHousehold`. Add draft, edit, confirm, cancel, and room-identity actions that call the new RPCs and translate stale/capacity/occupancy errors into safe operator messages.

- [ ] **Step 5: Redesign the screen**

Render Room plan, Summary, and Exceptions sections. Guest selectors require explicit choices. Cross-household sharing is visually identified. Confirmation controls show exactly who will share and require an affirmative action.

- [ ] **Step 6: Regenerate or hand-update checked database types**

Represent migrations `0048`–`0050`, including commands and views. Keep nullable compatibility fields accurate.

- [ ] **Step 7: Verify app**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: all pass and `.next/BUILD_ID` exists.

- [ ] **Step 8: Commit**

```bash
git add app/app/host/stay app/lib/data/room-plan.ts app/lib/data/room-plan.test.ts app/lib/data/stay.ts app/lib/database.types.ts
git commit -m "feat(stay): add explicit organizer room planning"
```

### Task 6: Add Sheet normalization and diff logic without credentials

**Files:**
- Create: `app/lib/sheets/roomSheetContract.ts`
- Create: `app/lib/sheets/roomSheetContract.test.ts`
- Create: `app/lib/sheets/roomSheetDiff.ts`
- Create: `app/lib/sheets/roomSheetDiff.test.ts`
- Create: `app/lib/sheets/roomSheetsGateway.ts`

**Interfaces:**
- Produces `RoomSheetRow`, `NormalizedRoomSheetChange`, `RoomSheetValidation`, `RoomSheetsGateway`.
- Protected identity fields include allocation ID, room ID, guest UUID companions, sync revision, timestamps, status, and error.

- [ ] **Step 1: Write failing contract tests**

Test duplicate-name display disambiguation, UUID-only resolution, ISO date parsing, blank-row ignore, explicit cancellation action, update-only rejection of blank/unknown IDs, duplicate guest IDs, and deterministic normalized output.

- [ ] **Step 2: Verify RED**

Run: `npm test -- lib/sheets/roomSheetContract.test.ts lib/sheets/roomSheetDiff.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement contract and diff**

Use no Google SDK types in normalization. A Sheet row never becomes SQL. It becomes a typed proposed change containing stable IDs, expected sync revision, normalized editable values, and validation codes.

- [ ] **Step 4: Define the adapter boundary**

`RoomSheetsGateway` exposes bounded methods to read/write the four named tabs and protected ranges. Production and fake implementations share the interface.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- lib/sheets/roomSheetContract.test.ts lib/sheets/roomSheetDiff.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/sheets
git commit -m "feat(sheet): define safe room workbook contract"
```

### Task 7: Add wedding-scoped Sheet staging and owner commit

**Files:**
- Create: `supabase/migrations/20260730123000_0051_room_sheet_sync.sql`
- Create: `supabase/tests/27_room_sheet_sync.sql`
- Modify: `scripts/run-sql-suites.sh`
- Modify: `app/lib/database.types.ts`

**Interfaces:**
- Produces `sheet_sync_connection`, `sheet_sync_run`, `sheet_sync_change`, `owner_preview_room_sheet_changes`, and `owner_commit_room_sheet_changes`.

- [ ] **Step 1: Write failing adversarial SQL suite**

Test owner-only configuration/preview/commit, event-manager denial, cross-wedding IDs, stale revision rejection, mixed valid/invalid preview, atomic coherent-batch rollback, commit replay idempotency, and no direct authenticated staging-table write.

- [ ] **Step 2: Verify RED**

Run: `./scripts/run-sql-suites.sh supabase/tests/27_room_sheet_sync.sql`

Expected: FAIL because migration `0051` does not exist.

- [ ] **Step 3: Implement minimal sync state machine**

Use statuses `detected`, `validated`, `committing`, `committed`, `rejected`, `superseded`, and `failed`. Permit only one committing run per wedding. Give each normalized change an idempotency key unique within its wedding/run.

- [ ] **Step 4: Implement preview and commit**

Preview validates without operational writes. Commit locks the run and relevant room plan rows, rechecks every revision and invariant, calls the room command logic, writes structured outcomes, and rejects stale state without overwriting Sangam.

- [ ] **Step 5: Minimise staged personal data**

Store UUIDs, normalized planning fields, validation codes, and safe summaries. Do not persist raw access tokens, Google credentials, contact values, or full workbook row snapshots.

- [ ] **Step 6: Verify GREEN**

Run: `./scripts/run-sql-suites.sh supabase/tests/27_room_sheet_sync.sql supabase/tests/04_rls_adversarial.sql`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260730123000_0051_room_sheet_sync.sql supabase/tests/27_room_sheet_sync.sql scripts/run-sql-suites.sh app/lib/database.types.ts
git commit -m "feat(db): stage and commit room sheet changes"
```

### Task 8: Implement read-only export and controlled review UI

**Files:**
- Create: `app/lib/sheets/googleRoomSheetsGateway.ts`
- Create: `app/lib/sheets/fakeRoomSheetsGateway.ts`
- Create: `app/lib/sheets/roomSheetService.ts`
- Create: `app/lib/sheets/roomSheetService.test.ts`
- Create: `app/app/host/stay/sheet/actions.ts`
- Create: `app/app/host/stay/sheet/page.tsx`
- Modify: `app/app/host/stay/StayView.tsx`
- Modify: `app/.env.example`
- Modify: `app/.env.production.example`

**Interfaces:**
- Produces owner actions `refreshRoomSheet`, `reviewRoomSheetChanges`, and `commitReviewedRoomSheetChanges`.

- [ ] **Step 1: Write failing service tests with the fake gateway**

Test deterministic export/upsert by allocation UUID, protected companion IDs, preservation of guest guidance tabs, staging without operational mutation, accepted/rejected previews, and authoritative re-export after commit.

- [ ] **Step 2: Verify RED**

Run: `npm test -- lib/sheets/roomSheetService.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement export through the adapter**

Create/update only `Room Allocation`, `Room Summary`, `Unallocated Guests`, and `Sync Conflicts`. Use the configured spreadsheet ID. Do not clear or rewrite `Guests` or `How to fill this in`.

- [ ] **Step 4: Implement review and commit actions**

Require a verified server session and wedding-owner role. `Review` reads bounded ranges and stages normalized changes. `Commit` passes only selected validated change IDs to the database RPC, then re-exports authoritative state.

- [ ] **Step 5: Implement preview UI**

Show accepted changes, rejected changes, current Sangam values, Sheet proposals, conflict reasons, and explicit commit selection. Disable commit for stale/rejected entries.

- [ ] **Step 6: Verify app**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/lib/sheets app/app/host/stay/sheet app/app/host/stay/StayView.tsx app/.env.example app/.env.production.example
git commit -m "feat(stay): add controlled room sheet workflow"
```

### Task 9: Certify against Supabase local and the pilot workbook

**Files:**
- Create: `app/scripts/verify-room-sheet-smoke.mjs`
- Modify: `.github/workflows/live-smoke.yml`
- Modify: `VALIDATION.md`
- Modify: `DEPLOY.md`
- Modify: `SANGAM_MANUAL.md`

**Interfaces:**
- Produces a separately gated read/write smoke test using the pilot spreadsheet ID and deployment secrets.

- [ ] **Step 1: Run every local database suite**

Run: `cd app && npm run verify:supabase-local`

Expected: all suites, including `27_room_sheet_sync.sql`, pass under real Supabase roles/auth.

- [ ] **Step 2: Run the clean app gate**

Run: `cd app && rm -rf node_modules .next && npm ci && npm test && npm run typecheck && npm run lint && npm run build && test -f .next/BUILD_ID`

Expected: zero dependency vulnerabilities; all commands pass; BUILD_ID exists.

- [ ] **Step 3: Implement the gated workbook smoke test**

The smoke verifies spreadsheet identity, required tabs, protected technical headers, `Asia/Kolkata` timezone, one harmless export/preview cycle, and no changes to guest guidance tabs. It exits without running unless the explicit live-smoke flag and credentials are present.

- [ ] **Step 4: Run the pilot smoke with deployment credentials**

Run: `cd app && ROOM_SHEET_LIVE_SMOKE=1 npm run verify:room-sheet`

Expected: PASS against spreadsheet `1WZiEFuewymVH5Q2Ynlf_pFOpS0snMQTqQwH7Gt56eAs`.

- [ ] **Step 5: Document operator recovery**

Document disable switch, stale-conflict recovery, credential rotation, re-export, and rollback. State that Sheet edits are proposals until owner commit.

- [ ] **Step 6: Commit**

```bash
git add app/scripts/verify-room-sheet-smoke.mjs .github/workflows/live-smoke.yml VALIDATION.md DEPLOY.md SANGAM_MANUAL.md
git commit -m "test: certify room sheet synchronization"
```

### Task 10: Final review and publication

**Files:**
- Modify only files required by review findings.

- [ ] **Step 1: Review migration ordering and privileges**

Confirm fresh databases and already-migrated databases both apply `0048`–`0051`; no function remains executable by PUBLIC; authenticated users cannot directly mutate protected room/sync tables.

- [ ] **Step 2: Review privacy behavior**

Confirm an owner sees the full plan, side admins see only their permitted guest identities, event managers cannot view/commit Sheet sync, and unrelated accounts see no room or sync rows.

- [ ] **Step 3: Run full verification again**

Run: `cd app && npm ci && npm test && npm run typecheck && npm run lint && npm run build && npm run verify:supabase-local`

Expected: all pass.

- [ ] **Step 4: Inspect final diff**

Run: `git diff --check origin/main...HEAD && git status --short`

Expected: no whitespace errors and only intentional files.

- [ ] **Step 5: Push and open a pull request**

```bash
git push -u origin codex/room-allocation-sheet-sync
gh pr create --base main --head codex/room-allocation-sheet-sync --title "feat: add controlled room allocation sheet sync" --fill
```

Expected: a reviewable PR with database, UI, Sheet, security, and live-smoke evidence; no automatic merge or deployment before checks pass.
