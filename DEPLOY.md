# Deploying Sangam (Coolify + Supabase + GitHub)

This runbook takes the Slice-1 app live: the **Next.js app on Coolify**, **Supabase** for Postgres + Auth +
RLS, and **GitHub** as the source of truth (Coolify auto-deploys on push to `main`). Every push runs the CI
release gate (`.github/workflows/ci.yml`) — the SQL suites as `anon`/`authenticated`/`service_role` on a
real Postgres 16 — before anything ships.

Decisions locked in `docs/adr/0001-slice1-locked-decisions.md` apply throughout — notably:
`INVITE_EXCHANGE_ENABLED` stays `0` until the recipient-bound exchange passes the expanded real-GoTrue and
browser acceptance journey in the hosted environment.

---

## 0. Architecture at a glance

```
GitHub repo ──push main──▶ CI (release gate: SQL suites + build)
     │
     └──▶ Coolify (auto-deploy) ──▶ Next app (standalone) ──▶ Supabase (Postgres + GoTrue Auth + PostgREST)
```

The app is Supabase-specific by design (`auth.uid()`, the `anon`/`authenticated`/`service_role` roles,
PostgREST RPC wrappers, RLS). The backend is therefore **Supabase** — either managed cloud or self-hosted;
it is **not** swappable for plain Postgres without a rewrite.

## 1. Prerequisites

- A server for Coolify — any small VPS (2 GB RAM is plenty for the pilot; e.g. Hetzner CX22, DigitalOcean).
- A domain (or subdomain) you can point at that server (e.g. `sangam.yourdomain.com`).
- A **Supabase** backend — pick one:
  - **A. Supabase Cloud** (recommended for the pilot): fastest, managed Auth/OTP, free tier covers one
    wedding, fully portable to self-host later.
  - **B. Self-hosted Supabase on Coolify**: full control now; more setup (secrets, SMTP, Kong, backups).
- An SMTP sender for the magic-link emails (Supabase Cloud's built-in works for low-volume pilot testing;
  use Resend/Postmark/SES for real use).

## 2. GitHub repo

You received a git bundle (`sangam.bundle`). Create an empty repo on GitHub, then:

```bash
git clone sangam.bundle sangam && cd sangam
git remote remove origin 2>/dev/null || true
git remote add origin git@github.com:YOURNAME/sangam.git
git push -u origin main
```

(Or unzip the delivered folder, `git init`, commit, and push — the bundle just preserves history.)

## 3. Backend — pick A or B

### A. Supabase Cloud
1. Create a project at supabase.com. Note the **Project URL**, **anon key**, and **service_role key**
   (Settings → API).
2. **Expose the `app` schema** — Settings → API → *Exposed schemas* → add `app` (keep `public`). The
   schedule reads query `app.*` via PostgREST and will 404 without this.
3. Apply the migrations (from your clone, with the Supabase CLI):
   ```bash
   supabase link --project-ref YOUR_REF
   supabase db push          # applies pending timestamped migrations in history order
   ```
   Prefer the CLI so migration history is recorded. If SQL Editor is unavoidable, run files in
   timestamp order and reconcile the history before the next CLI deployment.
4. Configure Auth — Authentication → URL Configuration:
   - **Site URL**: `https://sangam.yourdomain.com`
   - **Redirect URLs**: add `https://sangam.yourdomain.com/auth/callback`
   - Authentication → Providers → Email: enable, keep "Confirm email" on.
   - Authentication → Emails/SMTP: set your SMTP sender for production.

### B. Self-hosted Supabase on Coolify
1. In Coolify, add the **Supabase** service (Projects → New → Service → Supabase). Coolify provisions
   Postgres, GoTrue (Auth), PostgREST, Kong, Studio.
2. Set the generated secrets (JWT secret, `anon`/`service_role` keys) and an SMTP sender in the service
   env. Give the service a domain (e.g. `db.yourdomain.com`) with TLS.
3. Expose the `app` schema to PostgREST: set `PGRST_DB_SCHEMAS=public,app` (Kong/PostgREST env) — the
   equivalent of the cloud "Exposed schemas" step.
4. Apply migrations the same way (`supabase db push` against the self-hosted DB URL, or `psql -f` each
   file), then set Auth Site URL / redirect URLs to the app domain.

Either way, **certify the DB** before wiring the app: run the suites against it.
```bash
DATABASE_URL="postgres://postgres:...@host:5432/postgres" bash scripts/run-sql-suites.sh
```
(For the strongest gate with real GoTrue, `supabase start` locally and run the same suites — see below.)

## 4. App on Coolify
1. Coolify → New Resource → **Public/Private Repository** → your GitHub repo. Coolify installs a deploy
   webhook so pushes to `main` auto-deploy.
2. **Base directory**: `app` (the Next app lives in `app/`). Build pack: **Nixpacks** (auto-detects Next)
   or **Dockerfile** (`app/Dockerfile`) — either works; the Dockerfile produces the standalone image.
3. **Environment variables** (from `app/.env.production.example`):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `INVITE_EXCHANGE_ENABLED=0`
4. **Port**: `3000`. **Domain**: `sangam.yourdomain.com` → Coolify issues Let's Encrypt TLS automatically.
5. Deploy. Coolify builds the standalone server and runs `node server.js`.

## 5. Go-live checklist
- [ ] CI is green on `main` (release gate + build).
- [ ] The `supabase-real-auth` job is green (real GoTrue session + PostgREST/RLS smoke).
- [ ] `app` schema is exposed to PostgREST (Step 3.2 / 3.3).
- [ ] Auth **Site URL** and **redirect URL** exactly match the deployed domain (`…/auth/callback`).
- [ ] SMTP sender configured (or using Supabase's built-in for pilot testing).
- [ ] First-use smoke test: open the site → `/login` → verify the invited email once → land on `/schedule`
      → RSVP propose → confirm → status updates.
- [ ] Returning-guest smoke test: close the browser completely, reopen `/login`, and confirm the valid
      session redirects to `/schedule` without asking for another email/code.
- [ ] Automated browser-restart certification passes without printing secrets:
      `E2E_BASE_URL=https://sangam.yourdomain.com npm run verify:session` with `SUPABASE_URL` and
      `SUPABASE_SERVICE_ROLE_KEY` supplied from the operator environment.
- [ ] `INVITE_EXCHANGE_ENABLED=0` (the `/invite/[token]` route stays 404 until the expanded invite gate is certified).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only on the server (never a `NEXT_PUBLIC_*` var, never in the
      browser).

## 6. Seeding the pilot (one wedding)
Until the host/admin screens exist, seed via the SQL editor / service role: a `wedding`, a `wedding_owner`
`operator_role`, `household`/`guest` rows (each guest's `self_account_id` linked once they sign in), an
`event_function` + `event_instance` (+ `venue`), an `invitation` and `invitation_guest`. A guest signs in
with the email on their account; the schedule + RSVP then work. (Automated invite links stay behind the
flag per ADR-1/2.)

## 7. Ongoing
Delivery uses one bounded loop: open a pull request, let all three CI gates run, resolve supported P0/P1
findings using `CLAUDE_REVIEW.md`, merge, apply pending migrations, and let Coolify deploy `main`. The
`Live smoke` workflow then polls `https://sangam.vitan.in`, checks its health/configuration, checks public
pages for retired finance language, and confirms the retired finance URLs fail closed for anonymous users.

Schema changes are new files in `supabase/migrations/` applied with `supabase db push` (CI gates them first).
Roll back in Coolify by redeploying a previous commit; roll back a migration with a new forward corrective
migration (never edit an applied one).

The database push cannot run in GitHub until repository secrets for the managed Supabase project exist.
Until those are configured, the release operator runs `supabase link --project-ref <actual-20-character-ref>`
and `supabase db push` after CI succeeds. Never paste the literal placeholder `YOUR_SUPABASE_PROJECT_REF`.

## 8. The strong (real-auth) gate — mandatory before invite exchange
On any Docker-enabled machine:
```bash
supabase start                       # real Postgres + GoTrue + PostgREST + Studio
supabase db push                     # apply migrations
supabase status -o env > /tmp/supabase.env
set -a; source /tmp/supabase.env; set +a
(cd app && npm run verify:supabase-local)
```
This is separate from the psql suites: it creates disposable confirmed Auth users, signs in through real
GoTrue, verifies the recipient-bound invite journey (signed-out no-PII preview, wrong-contact denial,
intended redemption, and replay denial), then cleans every disposable row in `finally`. Keep the production
flag at `0` until this and the hosted browser acceptance journey pass.
