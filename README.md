# Sangam

A cross-border, two-family Indian wedding platform (bride's family in Ahmedabad; groom's in New York).
Slice-1 is **implemented**: a signed-in guest sees their personalized schedule and RSVPs to each event
through a two-step propose → confirm flow, all enforced at the database by Row-Level Security.

Built on **Supabase** (Postgres + GoTrue Auth + PostgREST + RLS). The app is Supabase-specific by design
(`auth.uid()`, the `anon`/`authenticated`/`service_role` roles, PostgREST RPC wrappers) — the backend is
Supabase, managed or self-hosted, not plain Postgres.

## Repo layout

```
sangam/
  docs/
    adr/0001-slice1-locked-decisions.md   # locked decisions (read first)
    SPEC_v0.3.2_DELTA.md, CONNECTION_MODEL.md
  supabase/
    config.toml                           # exposes the `app` schema to PostgREST; local auth config
    migrations/0001..0007_*.sql           # identity, guests, schedule, RSVP, food, privacy, grants
    tests/00..05_*.sql                    # role-based SQL suites (the release gate)
  app/                                    # Next.js 15 app (App Router)
    app/login, app/auth/*                 # email magic-link / OTP sign-in
    app/schedule/*                        # personalized schedule + two-step RSVP
    app/invite/[token]/*                  # recipient-bound invite exchange (flag-gated OFF)
    lib/*                                 # supabase clients, auth, commands, data layer, types
    Dockerfile                            # standalone production image
  scripts/run-sql-suites.sh               # applies migrations + runs the suites vs a DATABASE_URL
  .github/workflows/ci.yml                # release gate (SQL suites) + typecheck + build
  DEPLOY.md                               # Coolify + Supabase + GitHub go-live runbook
```

## Local development

```bash
# 1) Backend: a Supabase project (cloud) or `supabase start` (local, needs Docker)
#    Ensure the `app` schema is exposed to PostgREST (see supabase/config.toml / DEPLOY.md).
supabase db push                         # apply migrations 0001..0007

# 2) Certify the DB (the release gate)
DATABASE_URL="postgres://…" bash scripts/run-sql-suites.sh

# 3) App
cd app && npm install
cp .env.production.example .env.local     # fill SUPABASE_URL / ANON / SERVICE_ROLE; INVITE_EXCHANGE_ENABLED=0
npm run dev
```

Guests sign in at `/login` with the email on their account (`guest.self_account_id`), which lands on
`/schedule`.

## Non-negotiable invariants (see `docs/adr/0001`)

- RSVP goes **only** through `propose_rsvp_change` → `confirm_rsvp_change`. Never write `event_attendance`
  directly; never use the service role for guest actions.
- `INVITE_EXCHANGE_ENABLED` stays `0` until email OTP is verified end-to-end and the real-auth suites pass.
- Access links are email-only, self-binding, and bound to the exact issue-time contact. Proxy access is via
  `guest_delegation`, not the self-binding link flow.
- Keep the SQL suites green (CI enforces this on every push) before real-guest rollout.

## Deploy

See **DEPLOY.md** — Next app on Coolify, Supabase for the backend, GitHub auto-deploy, CI release gate.
