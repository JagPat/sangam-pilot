# Validation

Two gates verified: the **database** (real Postgres 16 ≈ Supabase, Supabase roles + auth stub, tests run
AS `authenticated`/`anon`) and the **app** (`npm ci` from the committed lockfile → `tsc` → `next build`).

## Database — all four suites pass (real signal)
Migrations **0001–0007** apply cleanly.
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
- `npm run build` → completes, `.next/BUILD_ID` = `zrW7uDa24CROkqG16lIuE`. `/invite/[token]` is
  **ƒ (Dynamic)**; a **Middleware** bundle is registered; no workspace-root warning; ESLint tooling is
  deliberately deferred to the UI phase (opted out in `next.config.mjs`).

## What changed this round (v8 — the three P1s)
1. **Cross-actor confirmation** — confirmer must equal the proposer; authority re-derived for the
   confirmer. Adversarial delegate→owner confirm test rejects.
2. **Structured audit provenance** — typed `channel`/`authority` columns on `audit_event` + CHECK,
   populated on RSVP; asserted by test.
3. **Recipient-bound exchange** — link carries a contact hash; redeem + details require a verified-contact
   match; wrong-contact rejected without consuming.

## Known follow-ups / integration boundary (before enabling the exchange)
- **Final DB gate**: run the four suites against **`supabase start`** (real auth). This sandbox uses an
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
