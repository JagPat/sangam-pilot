# Release tests

These prove the review's structural fixes hold at the **database** level (not just in app code).

## Run
On **supabase-local** the roles + auth already exist; just apply migrations and run all three files.
On a **plain Postgres**, create the auth stub + roles first:

```bash
# plain-postgres prerequisites (Supabase provides these already):
psql "$DATABASE_URL" -c "create schema if not exists auth; create table if not exists auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as \$\$
    select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid \$\$;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/00_roles.sql

# then (after migrations 0001-0007 are applied):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/01_constraints.sql   # constraints
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/02_rsvp_flow.sql     # functions (self-contained fixtures)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/03_rls.sql           # RLS, run AS authenticated
```

Each script prints `OK…` lines and raises loudly on any `FAIL`. A clean exit = pass.

## Coverage (maps to the reviews)
- **01_constraints.sql** (superuser: constraints) — attendance references only `invitation_guest`;
  instance-match; scoped uniqueness; muhurat CHECK incl. null-kind; cross-wedding isolation.
- **02_rsvp_flow.sql** (functions) — propose→confirm, count consistency, proxy attribution + audit,
  optimistic concurrency. Inserts its own `auth.users` fixtures (honest, self-contained).
- **03_rls.sql** (runs AS `authenticated`) — the two P0 regressions (ordinary member cannot read an
  uninvited event / hidden guest; a revoked-membership proxy cannot propose) + positives. **This is the
  layer the earlier superuser-only run could not see.**
- **04_rls_adversarial.sql** (AS `authenticated`/`anon`) — aggregate-view cross-wedding leak;
  `anon` cannot execute `SECURITY DEFINER` functions; unrelated `authenticated` cannot propose;
  cross-wedding reads; closed/expired RSVP; direct attendance writes denied; expired delegation.

Run 04 after 03 the same way: `psql ... -f supabase/tests/04_rls_adversarial.sql`.

## Deferred to their fast-follow gate (NOT here)
- "consent withdrawal after a message is scheduled" → **outbox** fast-follow.
- Uninvited-instance leakage via bot / exports, magic-link replay across devices → added with the
  guest-facing UI and bot modules.
