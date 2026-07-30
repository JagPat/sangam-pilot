# Sangam Room Allocation and Google Sheets Sync Design

Date: 2026-07-30

Status: Approved direction; implementation requires a separate plan and review

Product authority: Sangam is the source of truth

## 1. Objective

Extend Sangam's existing Stay & Travel module so organizers can:

- calculate the total number of rooms required;
- see counts by property and single, double, or triple occupancy;
- explicitly decide who shares each room;
- avoid single occupancy by default while permitting documented exceptions;
- support triple occupancy where the organizer explicitly approves it;
- plan with provisional room codes before properties issue physical room numbers;
- distinguish Suryagarh from each exact outside property; and
- use the existing Google Sheet as a controlled planning surface with validated two-way synchronization.

Google Sheet used for the pilot:

https://docs.google.com/spreadsheets/d/1WZiEFuewymVH5Q2Ynlf_pFOpS0snMQTqQwH7Gt56eAs/edit

Related Codex task:

codex://threads/019f6ab1-d100-7060-a877-e81ea689d21d

## 2. Governing decisions

1. Sangam is authoritative. A Sheet edit is a proposed change until Sangam validates and commits it.
2. Synchronization is asynchronous and controlled, not immediate cell-to-database mutation.
3. Default occupancy is double.
4. Triple occupancy is allowed only when the planner deliberately selects it and the room capacity is at least three.
5. Single occupancy is exceptional and requires a reason before confirmation.
6. Sangam never automatically groups unrelated guests. Every sharing group is explicitly confirmed by a planner.
7. Provisional identifiers such as `SUR-001` and `OUT-001` are stable planning codes. A later physical room number is a separate field and must not change the allocation identity.
8. Outside accommodation records the exact property. `Outside Suryagarh - TBD` is allowed temporarily.
9. Guest and room UUIDs are the sync keys. Names and room labels are never identity keys.

## 3. Existing implementation and gaps

The repository already contains:

- `app.hotel`;
- `app.room`;
- `app.room_allocation`;
- `app.room_occupant`;
- capacity and duplicate-occupant enforcement;
- `app.room_occupancy` and `app.stay_summary` views;
- `owner_allocate_household`;
- `/host/stay` and its server actions; and
- SQL coverage in `supabase/tests/11_stay_rooms.sql`.

Relevant files:

- `supabase/migrations/20260724032025_0017_stay_rooms.sql`
- `supabase/tests/11_stay_rooms.sql`
- `app/lib/data/stay.ts`
- `app/app/host/stay/actions.ts`
- `app/app/host/stay/StayView.tsx`
- `app/lib/database.types.ts`

The current model has four gaps:

1. `room.label` conflates a planning code and a physical room number.
2. `household_one_active_alloc` permits only one active room per household, so a family cannot be split across parents' and children's rooms.
3. `room_allocation.household_id` makes a room booking look household-owned even though roommates may span households. `room_occupant` should be the canonical membership.
4. `owner_allocate_household` automatically seats household members up to capacity; it does not model an explicitly reviewed cross-household sharing group.

## 4. Target data model

### 4.1 `app.hotel`

Keep the existing table. Add:

- `property_kind`: `suryagarh` or `outside`;
- `property_status`: `provisional` or `confirmed`, allowing the exact outside property to remain TBD during planning.

Do not encode every outside hotel as one generic property. Each actual property remains a separate `hotel` row.

### 4.2 `app.room`

Retain the UUID primary key. Add:

- `provisional_code text not null`, unique within a wedding;
- `physical_room_number text null`;
- `inventory_status`: `provisional`, `confirmed`, or `out_of_service` (or preserve `out_of_service` and add only `number_status`);
- an optional optimistic concurrency field such as `row_version bigint not null default 1`.

Migration behavior:

- copy existing `label` into `provisional_code`;
- leave `physical_room_number` null unless the existing value is known to be property-issued;
- keep `label` temporarily for compatibility, then remove it only after every consumer uses the new fields.

Display rule:

```text
physical_room_number ?? provisional_code
```

### 4.3 `app.room_allocation`

Treat an allocation as one room booking for a date range, not as ownership by one household.

- Rename `household_id` to nullable `primary_household_id` through a compatibility migration. It is for display and coordination only; `room_occupant` is authoritative.
- Remove `household_one_active_alloc`.
- Keep one active allocation per room for the pilot wedding. If later weddings require reused rooms across non-overlapping date ranges, replace this with an exclusion constraint that rejects only overlapping active ranges.
- Add `occupancy_plan`: `single`, `double`, or `triple`.
- Add `single_occupancy_exception_reason text null`.
- Add `sharing_confirmed_at timestamptz null` and `sharing_confirmed_by uuid null`.
- Add `row_version bigint not null default 1` for sync conflict detection.

Confirmation rules belong in one atomic RPC:

- exactly one occupant for `single`, with a nonblank exception reason;
- exactly two occupants for `double`;
- exactly three occupants for `triple`;
- occupant count cannot exceed `room.capacity`;
- no guest may occupy two active rooms;
- every occupant must belong to the same wedding;
- confirmation records the actor and timestamp.

Draft allocations may be incomplete. Only `confirmed` and later statuses must satisfy the exact occupancy-plan count.

### 4.4 `app.room_occupant`

Keep this as the canonical guest-to-room relationship. Add no name-based fallback. A guest UUID is required.

Cross-household sharing is permitted, but the UI must visibly identify it and require explicit sharing confirmation. Sangam must not infer or auto-create these pairings.

### 4.5 Views

Revise or add views to expose:

- rooms required and allocated by property;
- single, double, and triple counts;
- provisional versus physical room-number status;
- unallocated guests needing accommodation;
- underfilled, overfilled, and unconfirmed allocations;
- single-occupancy exceptions; and
- duplicate or conflicting assignments.

`stay_summary` should aggregate confirmed allocations separately from provisional inventory. It must not count a room merely because an inventory row exists when the user asks for rooms actually required.

## 5. Organizer experience

Redesign `/host/stay` into three focused sections.

### 5.1 Room plan

One card or row per allocation:

- property;
- provisional code;
- physical room number;
- occupancy plan;
- occupant names;
- confirmation state;
- exception/warning state; and
- check-in/check-out.

The planner chooses guests explicitly. Do not auto-fill unrelated guests.

### 5.2 Summary

Show:

- total confirmed rooms required;
- draft rooms still being planned;
- Suryagarh total;
- totals for each outside property;
- single, double, and triple totals;
- unallocated guest count;
- rooms missing physical numbers; and
- exception/conflict count.

### 5.3 Exceptions

Provide a work queue for:

- single rooms without an approved reason;
- underfilled confirmed rooms;
- rooms over capacity;
- the same guest assigned twice;
- guests requiring stay but not allocated;
- cross-household sharing awaiting confirmation;
- outside property still marked TBD; and
- stale Sheet edits rejected by version conflict.

## 6. Google Sheet contract

The pilot workbook should contain four operational tabs in addition to the existing guest guidance.

### 6.1 `Room Allocation`

One row per room allocation, with protected technical columns and editable planning columns.

Protected columns:

- `Allocation ID`;
- `Room ID`;
- `Row version`;
- `Last synced at`;
- `Sync status`;
- `Sync error`.

Editable columns:

- `Property`;
- `Provisional room ID`;
- `Physical room number`;
- `Occupancy plan`;
- `Guest 1`;
- `Guest 2`;
- `Guest 3`;
- `Single occupancy reason`;
- `Sharing confirmed?`;
- `Check-in`;
- `Check-out`;
- `Allocation status`;
- `Notes`.

Guest cells should display names but synchronize guest UUIDs through protected companion columns or validated lookup metadata. Duplicate names must be disambiguated using household and a short stable identifier.

### 6.2 `Room Summary`

Read-only output generated from Sangam, including total rooms and property/occupancy breakdowns. Do not make spreadsheet formulas the authoritative calculation.

### 6.3 `Unallocated Guests`

Read-only output of guests who require accommodation but are not in a confirmed allocation.

### 6.4 `Sync Conflicts`

Read-only output containing the rejected Sheet row, the current Sangam values, the reason, and the action required.

## 7. Controlled two-way synchronization

### 7.1 Authentication

Use Google Sheets API access from the Sangam server through a dedicated service account or approved OAuth connection. Store credentials only in the deployment secret manager. Share only the selected workbook with that identity.

Do not:

- place database service-role keys in Apps Script;
- trust an Apps Script payload as the source of row values;
- expose Supabase credentials in the workbook; or
- allow the browser to write directly to privileged sync tables.

### 7.2 Sangam to Sheet

An owner-triggered `Refresh Sheet` action and a scheduled job:

1. read authoritative allocations, occupants, properties, and summaries;
2. upsert rows by allocation UUID;
3. write row versions and timestamps;
4. preserve protected columns and validations; and
5. mark rows clean.

### 7.3 Sheet to Sangam

An owner-triggered `Review Sheet changes` action is the MVP. Optional scheduled detection may follow.

1. Sangam reads the workbook through the Google API.
2. Changed rows enter sync staging; they do not mutate operational tables directly.
3. Resolve every guest, property, room, and allocation by UUID.
4. Validate capacity, occupancy policy, dates, duplicate assignments, permissions, and row version.
5. Show a preview of accepted and rejected changes.
6. The owner commits accepted changes through one transactional RPC per coherent batch.
7. Sangam re-exports the committed state to the Sheet.

### 7.4 Conflict policy

If Sheet `row_version` differs from Sangam:

- reject that row;
- preserve Sangam;
- add a conflict record showing both versions; and
- require the planner to refresh and reapply the intended change.

Never use last-write-wins. Never identify rows by names or row numbers.

### 7.5 Suggested sync records

Add narrowly scoped tables such as:

- `sheet_sync_connection` — wedding, spreadsheet ID, enabled tabs, and configuration; no OAuth secrets;
- `sheet_sync_run` — direction, actor, timestamps, counts, and status;
- `sheet_sync_change` — staged normalized row, base version, validation result, and commit result.

Apply wedding-scoped RLS. Only wedding owners should configure or commit Sheet synchronization in the MVP. Event managers may receive a later explicit operational permission.

## 8. API and RPC changes

Replace `owner_allocate_household` for new writes with commands that express the target model:

- `owner_create_room_draft`;
- `owner_update_room_identity`;
- `owner_save_room_allocation_draft`;
- `owner_confirm_room_allocation`;
- `owner_cancel_room_allocation`;
- `owner_preview_sheet_changes`;
- `owner_commit_sheet_changes`.

Keep a compatibility wrapper only while existing UI paths are migrated. All multi-row mutations must be transactional and write `stay_activity`/audit records.

## 9. Validation and safety requirements

- A room's capacity cannot be reduced below its current active occupant count.
- Physical room number must be unique within a property when nonblank.
- Provisional code must be unique within a wedding.
- A confirmed single allocation requires a reason.
- Confirmed double/triple allocations require exactly two/three occupants.
- Draft allocations may be incomplete but must never exceed capacity or duplicate a guest.
- Cross-wedding IDs are rejected even when individually valid UUIDs.
- Sheet rows with unknown or deleted IDs are rejected, never recreated silently.
- Blank rows do not mean delete. Deletion/cancellation requires an explicit action value.
- A sync commit must be idempotent using the sync run/change IDs.
- Every accepted and rejected sync change is auditable without storing Google credentials or raw access tokens.

## 10. Test requirements

### SQL

Extend `supabase/tests/11_stay_rooms.sql` and adversarial RLS suites for:

- one household split across several rooms;
- cross-household sharing;
- single reason required on confirmation;
- exact double/triple occupant counts;
- guest double-book prevention;
- provisional and physical number uniqueness;
- stale version rejection;
- transactional batch rollback;
- cross-wedding ID attacks;
- owner-only sync configuration/commit; and
- idempotent sync replay.

### TypeScript

Add unit tests for:

- Sheet row normalization;
- UUID-based lookup and duplicate-name disambiguation;
- diff generation;
- conflict classification;
- occupancy summaries;
- preview counts; and
- friendly validation messages.

### Integration

Use a Google API adapter interface and a fake implementation in CI. Do not require live Google credentials for normal test runs. Add a separately gated smoke test for the pilot workbook.

### UI acceptance

- Planner can create `SUR-001`, choose double occupancy, and explicitly assign two guests.
- Planner can create a triple children's room and assign three guests.
- Planner cannot confirm a single room without a reason.
- Planner can later enter a physical Suryagarh room number without changing the allocation ID.
- Planner can assign an exact outside property or leave it as TBD with a visible warning.
- Summary counts match confirmed allocations, not merely inventory rows.
- A stale Sheet edit appears as a conflict and does not overwrite Sangam.

## 11. Delivery sequence

1. Database migration and compatibility views/RPCs.
2. Stay read model and organizer UI redesign.
3. Summary and exception queue.
4. Google adapter plus Sangam-to-Sheet export.
5. Sheet staging, preview, validation, and commit.
6. Pilot workbook setup and protected ranges.
7. Live smoke test using the provided workbook.

Do not begin with Apps Script or Sheet formatting. The database model and authoritative mutation path must be correct first.

## 12. Definition of done

- Sangam can model the approved single/double/triple policy without household-splitting constraints.
- Every confirmed sharing group is explicit and auditable.
- Total room counts are correct by property and occupancy.
- Provisional and physical room identifiers coexist safely.
- The Sheet can export, stage edits, preview results, commit valid changes, and report conflicts.
- Stale or invalid Sheet edits cannot overwrite Sangam.
- Existing stay, travel, service, guest, and family-oversight paths still pass their tests.
- Documentation and generated database types reflect the final schema.
