# Validation

Two gates verified: the **database** (local Postgres with Supabase roles + auth stub, tests run AS
`authenticated`/`anon`) and the **app** (`npm ci` from the committed lockfile → `tsc` → `next build`).
The linked production project runs Postgres 17; its migration history is aligned byte-for-byte by
timestamp through `20260726032455_0024_review_hardening.sql`.

## Session reliability

- Unit tests enforce same-origin post-auth redirects, authenticated `/login` bypass decisions, explicit
  persistent cookie options, and refresh-cookie propagation to both request and response.
- `npm run verify:session` is the deployed release gate: it signs in a disposable user, closes Chromium,
  reopens the same persistent browser profile, and proves `/login` redirects without another OTP.
- Production certification evidence must record only date, domain, browser/OS, CI URL, and pass/fail. It
  must never record the disposable email, token, cookie, or service-role key.

## Database — all 16 suites pass (real signal)
All **24 timestamped migrations** apply cleanly, including the recovered production guest-import
migration and the review-hardening migration.
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

## App — clean `npm ci`, typecheck, build
- `npm ci` (committed lockfile) → **0 vulnerabilities**; `npm run typecheck` → passes.
- `npm run build` → completes. `/invite/[token]` is
  **ƒ (Dynamic)**; a **Middleware** bundle is registered; no workspace-root warning; ESLint tooling is
  deliberately deferred to the UI phase (opted out in `next.config.mjs`).

## What changed in the post-review hardening
1. **Release gate discovery** — the runner executes every two-digit numbered suite, including 10–16.
2. **Shared event functions** — side admins cannot mutate names/types used by out-of-scope instances.
3. **Stay audit integrity** — non-owner entries are limited to authorized self-service actions, checked
   against domain rows, and summarized by the database rather than the caller.
4. **Co-host contract** — view-only co-hosts no longer receive family-admin navigation or write context.
5. **Reproducible app build** — project-local PostCSS config; patched Next/sharp lockfile; zero audit issues.

## Known follow-ups / integration boundary (before enabling the exchange)
- **Final DB gate**: run all suites against **`supabase start`** (real auth). The default local/CI gate uses an
  auth stub because `supabase start` needs Docker (unavailable here) — that certification is yours.
- **Session mint (OTP/magic-link)**: still the remaining integration. Crucially, it must send the OTP to
  the guest's **invited contact** so the verified session contact matches the link — that is what makes
  the recipient binding real end-to-end. Until it exists the flag stays off.
- **Service actor context**: the `whatsapp`/`import` RSVP paths don't exist yet. When built, a raw
  service-role call has **no mapped `auth.uid()`**, so `derive_rsvp_authority()`/the confirmer check would
  fail closed. Those commands must establish an explicit trusted acting-account context (e.g. set
  `request.jwt.claims` to the acting account) — designed with that module, not before.
- **Zoned-time P1** polish before real RSVP data is collected.

## Environment note
`security_invoker` views require **PostgreSQL 15+**; validated here on **16.13** (matches Supabase's
current Postgres). Confirm your project's PG major version is ≥15.
