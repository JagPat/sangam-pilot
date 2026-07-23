#!/usr/bin/env bash
# Automated form of the release gate (see docs/adr/0001, decision 7).
#
# Applies the Supabase-style auth stub + roles + all migrations, then runs the SQL suites (01-05) against
# the Postgres at $DATABASE_URL. Used by CI (a postgres:16 service container) and reproducible locally.
# The auth stub only mirrors what real Supabase provides (an auth.users table + auth.uid() reading the JWT
# claim); the roles anon/authenticated/service_role and the RLS logic are exercised for real.
#
# For the STRONGER gate with real GoTrue auth, run `supabase start` + `supabase db push` and execute the
# same suites against it (see DEPLOY.md); that additionally covers the live OTP/session path.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/postgres}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql_run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }

echo "### auth stub + roles (Supabase provides these in a real project)"
# Mirror the columns our functions actually read from auth.users: id (everywhere) + email (0009's
# link_signed_in_account derives the VERIFIED email straight from the auth record). `add column if not
# exists` keeps this idempotent if the table already exists from a prior local run.
psql_run -c "create schema if not exists auth;
             create table if not exists auth.users(id uuid primary key, email text);
             alter table auth.users add column if not exists email text;
             create or replace function auth.uid() returns uuid language sql stable as \$\$
               select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid \$\$;"
psql_run -f "$ROOT/supabase/tests/00_roles.sql"

echo "### migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  -> $(basename "$f")"
  psql_run -f "$f"
done

echo "### suites"
for f in "$ROOT"/supabase/tests/0[1-9]_*.sql; do
  echo "  === $(basename "$f") ==="
  psql_run -f "$f"
done

echo "### ALL SUITES PASSED"
