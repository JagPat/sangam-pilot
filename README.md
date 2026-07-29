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
    migrations/202607*_*.sql              # timestamped Supabase history
    tests/00..26_*.sql                    # role-based SQL suites (the release gate)
  app/                                    # Next.js 15 app (App Router)
    app/login, app/auth/*                 # scanner-safe email OTP sign-in
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
supabase db push                         # apply all migrations

# 2) Certify the DB (the release gate)
DATABASE_URL="postgres://…" bash scripts/run-sql-suites.sh

# 3) App
cd app && npm install
cp .env.production.example .env.local     # fill Supabase values + PUBLIC_SITE_URL; keep invite flag 0
npm run dev
```

Guests sign in at `/login` with the email on their account (`guest.self_account_id`), which lands on
`/schedule`. Returning guests keep the rotated secure session and are not asked for another code while it
remains valid.

Approved wedding creators can create a wedding from `/host/setup`; creation atomically provisions their
membership, `wedding_owner`, and `event_manager` access. The platform super-admin enables this capability
from `/host/platform`.

Event managers and separately appointed cost approvers use `/host/cost-control`. It records only official
target/approved estimates, commitments, invoices, and payment status. It never records family contributions,
bank statements, sources of funds, private balances, or which family funded an item.

## Non-negotiable invariants (see `docs/adr/0001`)

- RSVP goes **only** through `propose_rsvp_change` → `confirm_rsvp_change`. Never write `event_attendance`
  directly; never use the service role for guest actions.
- `INVITE_EXCHANGE_ENABLED` stays `0` in production. Recipient-bound exchange is implemented, but may be
  enabled only after the expanded real-GoTrue and browser acceptance journey is certified in the hosted environment.
- Access links are email-only, self-binding, and bound to the exact issue-time contact. Proxy access is via
  `guest_delegation`, not the self-binding link flow.
- `PUBLIC_SITE_URL` is required for host issuance and must be the canonical public HTTPS origin (for example,
  `https://sangam.example`) with no path, query, or fragment. Invite URLs never trust request Host/Origin headers.
- Keep the SQL suites green (CI enforces this on every push) before real-guest rollout.
- Keep event-manager operations and cost-approver decisions independent; neither role is implied by wedding
  ownership.

## Deploy

See **DEPLOY.md** — Next app on Coolify, Supabase for the backend, GitHub auto-deploy, CI release gate, and
automatic live smoke verification of `sangam.vitan.in` after a green main build.
