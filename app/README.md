# Sangam app (Slice-1 skeleton)

The **backend contract is the real deliverable**: the migrations, RLS, and the `propose/confirm` RSVP
functions. This app package gives you the correct wiring around them; the UI is intentionally stubbed
so Claude Code / Codex can build the Slice-1 screens against a solid foundation.

## What's wired
- `lib/supabase/clients.ts` — user-context client (RLS applies; anon key) + a narrow, server-only
  `serviceCommand()` for imports/webhooks/jobs. The service-role key never reaches the browser.
- `lib/commands/rsvp.ts` — the single RSVP path (`proposeRsvpChange` → `confirmRsvpChange`). The
  WhatsApp bot fast-follow must call the same SQL functions.
- `lib/auth/accessLink.ts` — invite token helpers: `peekInvite()` (READ-ONLY validity check, **no PII** —
  safe for the unauthenticated preview), `peekInviteDetails()` (returns the guest name; called only after
  a verified session), and `redeemInvite()` (atomic single-use bind). The token is the sole wedding/guest
  authority; the account comes from a verified session, never the URL.
- `lib/supabase/middleware.ts` + `middleware.ts` — Supabase session refresh on every request (rotates
  the auth cookie and propagates it to request + response), so read-only handlers see a fresh session.

## Invite exchange (wired — two-step, gated)
- `app/invite/[token]/page.tsx` (GET) validates the token **without consuming it** —
  prefetch/scanners/retries/shared devices can't silently burn a link. Unauthenticated visitors get a
  no-PII validity check (`peekInvite()`); the guest name (`peekInviteDetails()`) is shown only once
  signed in **and only when the session's verified contact matches the invited recipient** — so a
  forwarded link opened by a different authenticated account sees no name and gets a "sent to a different
  contact" notice.
- `app/invite/[token]/actions.ts` (POST server action, CSRF-protected by Next) reads the account from
  the verified session and calls `redeemInvite()` (the single redemption path), passing the verified
  contact — redemption is **recipient-bound**, so an arbitrary session + bearer token cannot redeem.
- The whole route is dark until `INVITE_EXCHANGE_ENABLED=1` (kept off until session-mint is wired and
  the DB is certified against Supabase-local).

## Build next (Slice-1 UI — TODO)
Suggested route stubs:
- `app/schedule/page.tsx` → the guest's personalized itinerary (invited instances only), each in the
  guest's local time + venue time; muhurat shown per `muhurat_kind`; ICS download (with a revision id).
- `app/rsvp/[invitationGuestId]/page.tsx` → propose → **echo a confirmation** → confirm.
- `app/now/page.tsx` → "Now/Next" using `app.effective_event_state`; "last updated" + stale banner.
- `app/host/dashboard/page.tsx` → per-instance counts from `app.instance_rsvp_counts` /
  `app.caterer_report` (owner only).

## Env
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (client + server), `SUPABASE_SERVICE_ROLE_KEY` (server only),
`INVITE_EXCHANGE_ENABLED` (set to `1` to turn on the invite route; off/unset keeps it 404).

## Guardrails
- Never write `app.event_attendance` directly — go through the functions.
- Don't add fast-follow tables (outbox, bot, travel, Bridge, chandlo, assistance) until their module
  starts. Keep `supabase/tests/` green before real-guest rollout.
