# Deploying Sangam (Coolify + Supabase + GitHub)

This runbook takes the Slice-1 app live: the **Next.js app on Coolify**, **Supabase** for Postgres + Auth +
RLS, and **GitHub** as the source of truth (Coolify auto-deploys on push to `main`). Every push runs the CI
release gate (`.github/workflows/ci.yml`) — the SQL suites as `anon`/`authenticated`/`service_role` on a
real Postgres 16 — before anything ships.

Decisions locked in `docs/adr/0001-slice1-locked-decisions.md` apply throughout — notably:
`INVITE_EXCHANGE_ENABLED` stays `0` until email OTP is verified end-to-end.

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
   supabase db push          # applies supabase/migrations/0001..0007 in order
   ```
   (No CLI? In the SQL editor, run each file in `supabase/migrations/` in numeric order.)
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
- [ ] `app` schema is exposed to PostgREST (Step 3.2 / 3.3).
- [ ] Auth **Site URL** and **redirect URL** exactly match the deployed domain (`…/auth/callback`).
- [ ] SMTP sender configured (or using Supabase's built-in for pilot testing).
- [ ] Smoke test: open the site → `/login` → enter an email that is a guest's `self_account` → click the
      emailed link → land on `/schedule` → RSVP propose → confirm → status updates.
- [ ] `INVITE_EXCHANGE_ENABLED=0` (the `/invite/[token]` route stays 404 until OTP is proven).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only on the server (never a `NEXT_PUBLIC_*` var, never in the
      browser).

## 6. Seeding the pilot (one wedding)
Until the host/admin screens exist, seed via the SQL editor / service role: a `wedding`, a `wedding_owner`
`operator_role`, `household`/`guest` rows (each guest's `self_account_id` linked once they sign in), an
`event_function` + `event_instance` (+ `venue`), an `invitation` and `invitation_guest`. A guest signs in
with the email on their account; the schedule + RSVP then work. (Automated invite links stay behind the
flag per ADR-1/2.)

## 7. Ongoing
Push to `main` → CI runs the release gate + build → on green, Coolify auto-deploys. Schema changes are new
files in `supabase/migrations/` applied with `supabase db push` (CI gates them first). Roll back in Coolify
by redeploying a previous commit; roll back a migration with a new down-migration (never edit an applied
one).

## 8. The strong (real-auth) gate — optional but recommended before real guests
On any Docker-enabled machine:
```bash
supabase start                       # real Postgres + GoTrue + PostgREST + Studio
supabase db push                     # apply migrations
DATABASE_URL="$(supabase status -o env | grep DB_URL | cut -d= -f2-)" bash scripts/run-sql-suites.sh
```
This exercises the same suites against real GoTrue (covering the live OTP/session path the auth-stub gate
in CI cannot), closing the ADR-7 release gate.
