# Sangam app (Slice-1)

Slice-1 schedule, RSVP, host management, and code-only OTP sign-in are implemented on top of the
migrations, RLS, and `propose/confirm` RSVP contract.

## What's wired
- `lib/supabase/clients.ts` — user-context client (RLS applies; anon key) + a narrow, server-only
  `serviceCommand()` for imports/webhooks/jobs plus the narrowly authorized invite issuance/exchange paths.
  The service-role key never reaches the browser.
- `lib/commands/rsvp.ts` — the single RSVP path (`proposeRsvpChange` → `confirmRsvpChange`). The
  WhatsApp bot fast-follow must call the same SQL functions.
- `lib/auth/accessLink.ts` — invite token helpers: `peekInvite()` (READ-ONLY validity check, **no PII** —
  safe for the unauthenticated preview), `peekInviteDetails()` (returns the guest name; called only after
  a verified session), and `redeemInvite()` (atomic single-use bind). The token is the sole wedding/guest
  authority; the account comes from a verified session, never the URL.
- `lib/supabase/middleware.ts` + `middleware.ts` — Supabase session refresh on every request (rotates
  the auth cookie and propagates it to request + response), so read-only handlers see a fresh session.
- `/login` checks the verified session before rendering. A returning guest with a valid session is sent
  directly to their schedule or authorized organizer console; email verification is first-use/recovery,
  not an every-visit requirement. Auth cookies are persistent while Supabase controls session validity.

## Invite exchange (implemented — two-step, production-gated)
- `app/invite/[token]/page.tsx` (GET) validates the token **without consuming it** —
  prefetch/scanners/retries/shared devices can't silently burn a link. Unauthenticated visitors get a
  no-PII validity check (`peekInvite()`); the guest name (`peekInviteDetails()`) is shown only once
  signed in **and only when the session's verified contact matches the invited recipient** — so a
  forwarded link opened by a different authenticated account sees no name and gets a "sent to a different
  contact" notice.
- `app/invite/[token]/actions.ts` (POST server action, CSRF-protected by Next) reads the account from
  the verified session and calls `redeemInvite()` (the single redemption path), passing the verified
  contact — redemption is **recipient-bound**, so an arbitrary session + bearer token cannot redeem.
- The host issues a raw link once through a service-only command. PostgreSQL independently verifies the
  session-derived actor is an active wedding owner, requires exactly one guest-specific unshared email, and
  fixes expiry at 30 days; the database stores only hashes. The returned absolute URL is based only on the
  configured canonical `PUBLIC_SITE_URL`. The whole route stays dark in production until the
  expanded real-GoTrue and browser acceptance journey has been certified.

## Release state

- Sign-in is code-only and sessions persist until Supabase expires or revokes them.
- Schedule and RSVP are implemented for Slice-1.
- Cost Control now provides an official-position dashboard, a separate approver decision queue, and an
  event-manager-only staged CSV import. Imports create draft estimates only and never accept private family
  finance fields.
- Recipient-bound invite exchange is implemented but disabled in production pending the real-auth/browser gate.

## Env
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (client + server), `SUPABASE_SERVICE_ROLE_KEY` (server only),
`PUBLIC_SITE_URL` (required canonical HTTPS origin, with no path/query/fragment),
`INVITE_EXCHANGE_ENABLED` (keep `0` in production until the real-auth/browser gate is certified; off/unset keeps it 404).

## Guardrails
- Never write `app.event_attendance` directly — go through the functions.
- Don't add fast-follow tables (outbox, bot, travel, Bridge, chandlo, assistance) until their module
  starts. Keep `supabase/tests/` green before real-guest rollout.

## Persistent-session verification

After deploying, certify a real browser restart with a disposable Supabase Auth user:

```bash
E2E_BASE_URL=https://sangam.vitan.in \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
npm run verify:session
```

The script stores no secret in the repository, prints no contact/token/cookie value, and deletes the
disposable Auth user and `app.account` row in `finally`.
