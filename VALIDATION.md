# Validation

Two local gates are verified: the **database** (local Postgres with Supabase roles + auth stub, tests run AS
`authenticated`/`anon`) and the **app** (`npm ci` from the committed lockfile → tests → `tsc` → `next build`).
CI has a separate `supabase-real-auth` job that starts the genuine Supabase stack and obtains a GoTrue
session before exercising PostgREST as anon/authenticated/service-role. This machine has no Docker binary,
so that distinct gate must be green in GitHub before enabling invite exchange.
The linked production project runs Postgres 17. This branch contains 47 timestamped migrations through
`20260729113000_0047_server_invite_issuance.sql`; production alignment must be re-certified before rollout.

## Session reliability

- Unit tests enforce same-origin post-auth redirects, authenticated `/login` bypass decisions, explicit
  persistent cookie options, and refresh-cookie propagation to both request and response.
- `npm run verify:session` is the deployed release gate: it signs in a disposable user, closes Chromium,
  reopens the same persistent browser profile, and proves `/login` redirects without another OTP.
- Production certification evidence must record only date, domain, browser/OS, CI URL, and pass/fail. It
  must never record the disposable email, token, cookie, or service-role key.
- **2026-07-26 — PASS:** `https://sangam.vitan.in`, Playwright Chromium 151 on macOS arm64. The session
  survived a complete persistent-profile browser restart and `/login` redirected without another OTP.
  CI: <https://github.com/JagPat/sangam-pilot/actions/runs/30187842113>. Cleanup verified zero disposable
  Auth users and zero disposable `app.account` rows.

## Database — 27 suites (`00`–`26`)
All **47 timestamped migrations** through `0047_server_invite_issuance` and all 27 SQL suites are the current
release gate. On 2026-07-29 they passed from scratch against an isolated local PostgreSQL database.
- **01_constraints** — muhurat CHECK, invitation↔instance match, no double-invite, derived attendance,
  cross-wedding isolation.
- **02_rsvp_flow** — propose→confirm, derived counts, optimistic concurrency; both provenance dimensions
  derived (`channel=web`, `authority=delegate`).
- **03_rls** (AS `authenticated`) — P0-1 (uninvited/hidden reads) + P0-2 (revoked proxy) blocked; derived
  `authority=delegate` / `channel=web` asserted.
- **04_rls_adversarial** (AS `authenticated`/`anon`):
  - Aggregate views owner-only (`security_invoker`); non-owner gets EMPTY, never cross-wedding.
  - `anon` has no schema access; direct `event_attendance` INSERT permission-denied; unrelated
    `authenticated` cannot propose; closed / past-deadline / expired-delegation RSVP rejected.
  - Host CAN write; `bind_guest_account` rejects an unknown guest; one pending proposal per ig.
  - **Redeem is RECIPIENT-BOUND**: a wrong verified contact is rejected **and does not consume** the link;
    correct (case-insensitive) contact binds; single-use, idempotent-by-account, conflict-rejecting.
  - **`peek_access_link`** returns validity only (no name); **`peek_invite_details`** returns the name
    **only on a verified-contact match** (wrong contact → no name), and never consumes.
  - **Owner acting for a guest derives `authority=operator`** (never `proxy`); **`audit_event` carries the
    structured `channel`/`authority` columns** (asserted, not parsed from text).
  - **Cross-actor confirmation is rejected**: a delegate proposes, the owner cannot confirm it.
- **10–16 operator modules** — family-admin isolation, stay/rooms/travel/services, oversight logging,
  group events, vendors and finance. The gate now actually discovers and runs these suites.
- **14_stay_oversight** — an ordinary guest cannot forge manager activity; guest self-service entries
  are authorized against authoritative rows and use database-derived summaries.
- **15_group_events** — a side admin cannot rename/type a function shared by another side's instance.

## Provenance model — channel vs. authority, consistent actor (P1s fixed)
- Two orthogonal columns everywhere (proposal / attendance / change-log / audit): **`rsvp_channel`**
  (`web|whatsapp|import`, the transport — set only by the trusted server path) and **`rsvp_authority`**
  (`self|delegate|operator`, **derived** from the relationship). An owner without a delegation is
  `operator`, never `proxy`.
- **Cross-actor attribution closed**: `confirm_rsvp_change` now requires the confirmer to be the account
  that made the pending proposal, and **re-derives the authority for that confirmer** at commit time. So
  `responded_by_account_id` and `responded_as` always describe the same person, and a delegation that
  lapsed mid-window can't leave a stale `delegate` on the record.
- **Structured audit**: `audit_event` gained typed `channel`/`authority` columns plus a CHECK (`action =
  'rsvp'` ⇒ both non-null). Reports query/aggregate typed columns; `safe_summary` is a human echo only.

## Recipient-bound invite exchange (P1s fixed)
- **Unauthenticated visitors** (scanners, unfurl/preview bots) get validity only via `peek_access_link` —
  which has **no guest-name column at all** — and cannot consume the link.
- **Recipient binding**: each link stores a hash of the contact it was issued to (`issue_access_link` now
  requires that contact). **Both** `redeem_and_bind` **and** `peek_invite_details` require the session's
  **verified contact to match** — so a valid Supabase session for *some other account* holding a forwarded
  link can neither redeem nor see the guest's name. A session proves account ownership; the contact match
  proves intended-recipient. The app passes the verified session contact; `page.tsx` shows a "sent to a
  different contact" notice on mismatch, and `actions.ts` redemption fails closed.
- Two-step exchange unchanged: non-consuming GET + CSRF-protected POST server action; the token is the
  sole wedding/guest authority; the whole route is gated by `INVITE_EXCHANGE_ENABLED`.
- Host issuance is service-only and accepts no browser-supplied actor, contact, or lifetime. Trusted server
  code maps the `auth.getUser()` identity to an account; PostgreSQL rechecks active `wedding_owner` membership,
  locks and requires exactly one guest-specific unshared email, and fixes expiry at 30 days. The absolute URL
  uses required `PUBLIC_SITE_URL`, validated as a canonical HTTPS origin rather than request headers.

## App — clean `npm ci`, tests, typecheck, build
- `npm ci` uses the committed lockfile; `npm audit` reports **0 vulnerabilities**; lint, tests, and
  `npm run typecheck` pass.
- `npm run lint` is a required CI step; `npm run build` completes. `/invite/[token]` is
  **ƒ (Dynamic)** and a **Middleware** bundle is registered.

## What changed in the post-review hardening
1. **Release gate discovery** — the runner executes every two-digit numbered suite, including 10–16.
2. **Shared event functions** — side admins cannot mutate names/types used by out-of-scope instances.
3. **Stay audit integrity** — non-owner entries are limited to authorized self-service actions, checked
   against domain rows, and summarized by the database rather than the caller.
4. **Co-host contract** — view-only co-hosts no longer receive family-admin navigation or write context.
5. **Reproducible app build** — project-local PostCSS config; patched Next/sharp lockfile; zero audit issues.

## Known follow-ups / integration boundary (before enabling the exchange)
- **Final real-auth gate**: the GitHub `supabase-real-auth` job must pass. The default psql gate intentionally
  remains fast and uses an auth stub; it does not claim to exercise GoTrue or PostgREST.
- **Hosted invite certification**: code-only email OTP and persistent sessions are implemented. The remaining
  release boundary is a green hosted real-auth/browser journey proving the OTP-verified guest contact matches
  the guest-specific invite contact end-to-end. Until that passes, the production flag stays off.
- **Service actor context**: the `whatsapp`/`import` RSVP paths don't exist yet. When built, a raw
  service-role call has **no mapped `auth.uid()`**, so `derive_rsvp_authority()`/the confirmer check would
  fail closed. Those commands must establish an explicit trusted acting-account context (e.g. set
  `request.jwt.claims` to the acting account) — designed with that module, not before.
- Travel now stores the submitted wall clock, IANA timezone, derived offset, and UTC instant. Keep the
  timezone selector vocabulary aligned with pilot travel origins as they expand.

## 2026-07-26 release-gate remediation

- RSVP confirmation returns and retains the committed row version, so successive changes do not self-conflict.
- Service requests have composite wedding/subject constraints and per-person/per-household scope enforcement;
  dashboard totals are separated by currency.
- Directory is explicit opt-in; invite exchange requires a confirmed email; email changes and guest deletion
  revoke stale identity bindings when no other authority basis remains.
- Add-guest, invite-guest, and room allocation are transactional RPCs; occupant checks lock the allocation and
  guest rows to serialize concurrent writes.
- Organizer guest/invitation/attendance reads page beyond Supabase's 1,000-row default and use indexed lookups.
- Wedding creation is restricted to explicitly provisioned accounts (`app.account.can_create_wedding`).

## Environment note
`security_invoker` views require **PostgreSQL 15+**; the current clean release gate is validated on
**PostgreSQL 17**. Confirm your hosted project's PG major version is ≥15.

## Controlled room-planning Sheet

- SQL suites `27_room_commands.sql` and `28_room_sheet_sync.sql` prove command-only writes, exact confirmation, stale rejection, owner-only staging/commit, direct-write denial, and idempotent replay.
- The app tests cover UUID companion columns, update-only imports, ISO dates, duplicate guests, deterministic diffs, and preservation of the existing guest/guidance tabs.
- `npm run verify:room-sheet` is read-only and runs only with `ROOM_SHEET_LIVE_SMOKE=1`; it checks the exact workbook, required tabs, protected headers, the Kolkata timezone (`Asia/Kolkata` or Google's canonical alias `Asia/Calcutta`), and a guest-sheet sentinel without printing credentials or guest data.
