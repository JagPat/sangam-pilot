# v0.3.2 delta — how the review's blockers are resolved in SQL

This scaffold applies the v0.3.1 review. Each blocker is resolved by a **database constraint**, not a
command, so the guarantee holds even if application code has a bug.

## Blocker 1 — attendance must be DB-authorized by its invitation
**Fix (0004):** `event_attendance` stores **only** `invitation_guest_id` (plus status/attribution).
Guest and instance are **derived** through `invitation_guest`, so an attendance row cannot pair a
valid `invitation_guest` with a different guest/instance. `invitation_guest` denormalizes
`event_instance_id` and is constrained so it always matches its invitation's instance:

- `invitation` has `UNIQUE (wedding_id, id, event_instance_id)`.
- `invitation_guest (wedding_id, invitation_id, event_instance_id, guest_id)` has a composite FK
  `(wedding_id, invitation_id, event_instance_id) → invitation(wedding_id, id, event_instance_id)`.
- `event_attendance` has `UNIQUE (wedding_id, invitation_guest_id)` and a single FK to
  `invitation_guest`. The "a command asserts…" language is gone; the DB enforces it.
- A view `attendance_expanded` exposes the derived `guest_id`/`event_instance_id` for counts.

## Blocker 2 — scoped-uniqueness invariant must match the SQL
**Fix (all migrations):** every one-per-scope constraint includes `wedding_id`. Examples:
`event_attendance UNIQUE (wedding_id, invitation_guest_id)`;
`invitation_guest UNIQUE (wedding_id, event_instance_id, guest_id)` (no double-invite to an instance);
`wedding_membership UNIQUE (wedding_id, account_id)`;
`operator_role UNIQUE (wedding_id, account_id, role, host_group_id)`;
`guest_dietary_profile UNIQUE (wedding_id, guest_id)`;
`directory_card UNIQUE (wedding_id, guest_id)`. No bare `(event_instance_id, guest_id)`.

## Blocker 3 — scaffold boundary is honest
**Fix (migrations + README):** the boundary is **0001–0005 + a minimal Slice-1 privacy/localization
migration (0006)** — not "1–5." `assistance_request` and retention-*execution* jobs are **deferred**
(only `retention_policy` semantics are present). The "consent withdrawal after a message is
scheduled" test is moved to the **outbox fast-follow** gate (it is not a Slice-1 test here).

## Blocker 4 — required Slice-1 entities are present
**Fix (0002/0003/0004):** added `guest_access_link` (Sangam invitation token → exchanged for a
Supabase session; **no provider auth secrets are persisted**), `guest_import_batch` /
`guest_import_row`, `schedule_revision` + `schedule_acknowledgement` (distinct from content
`publication_revision`), `invitation_plus_one`, `guest_tag` / `guest_tag_assignment`, and a
`delegation_notification_recipient` routing table so reminders reach the proxy without overwriting
the elder's contact.

## Blocker 5 — original wall time preserved everywhere it matters
**Fix (0003):** a reusable **`zoned_time` composite type** (`instant timestamptz, wall_local timestamp,
offset_minutes int, source text`) is used for `arrival`, `ceremony_start`, `muhurat_start`,
`muhurat_end`, and (fast-follow) travel times, with instance-level `time_confirmed_by/at`. The muhurat
CHECK also **rejects start/end when `muhurat_kind IS NULL`**, not just when populated.

## Additional constraint fixes
- `operator_role` CHECK: `wedding_owner ⇒ host_group_id IS NULL`; `host_group_admin`/`co_host ⇒ NOT NULL`.
- Operator/captain/delegate accounts must have an **active membership** in the same wedding
  (composite FK to `wedding_membership (wedding_id, account_id)` + status check via trigger).
- `guardian_assignment` requires **exactly one** guardian identity (`num_nonnulls(...) = 1` CHECK).
- `rsvp_proposal` references `invitation_guest`, not an independently supplied guest/instance.
- Controlled value sets are Postgres **enums** (attendance/invitation status, delegation capability,
  consent purpose, audit action, muhurat kind, event live-state).
- **Optimistic concurrency:** `event_attendance.row_version` is checked-and-incremented inside
  `confirm_rsvp_change`, so a guest and a proxy racing on the same RSVP cannot clobber each other.

## Document QA note
The prior page-count remark (20 vs 21) was a reporting difference only; this scaffold supersedes the
prose for schema purposes. A **targeted SQL review of these migrations** is the recommended next check.
