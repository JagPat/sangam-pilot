# Release tests

These prove the review's structural fixes hold at the **database** level (not just in app code).

## Run
The whole gate is one command — it applies the auth stub + roles + every migration, then runs every
`0N_*.sql` suite in order (new suites are auto-discovered; no runner edit needed). This is exactly what CI
(`.github/workflows/ci.yml`, the `db-gate` job) runs against a `postgres:16` service container:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bash scripts/run-sql-suites.sh
```

It prints a `### ALL SUITES PASSED` banner and exits non-zero on the first `FAIL`. To run a single file by
hand on a **plain Postgres**, create the auth stub + roles first (Supabase provides these already):

```bash
# plain-postgres prerequisites — mirror the auth.users columns our functions read (id + email):
psql "$DATABASE_URL" -c "create schema if not exists auth; create table if not exists auth.users(id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as \$\$
    select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid \$\$;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/00_roles.sql
# then, after migrations are applied:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/06_account_link.sql   # migration 0009
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
- **05_slice1_schedule.sql** (AS `authenticated`) — the guest schedule read path returns exactly the
  guest's invited events (function + venue + status) and no uninvited/other-wedding rows.
- **06_account_link.sql** — migration **0009** `link_signed_in_account`: verified-email is the sole key;
  adopt an unlinked pre-seeded account; create-and-bind when none exists; **no hijack** of an already-bound
  guest; shared household contacts don't bind (personal only); don't steal an email already linked to
  another auth user; bind across every wedding the email is a guest in; idempotent + null-safe;
  **service-only** execute (anon/authenticated blocked).
- **07_owner_setup.sql** — migration **0010** setup RPCs: `create_wedding` bootstraps the caller as
  `wedding_owner` (which RLS alone could not); blank title + accountless caller rejected;
  `owner_create_event`/`owner_update_event` build the `app.zoned_time` with the correct offset
  (IST +330, EDT −240, EST −300) and rename/move/cancel; a non-owner cannot create or edit;
  the internal `build_zoned_time` is not executable by `authenticated`.
- **08_finance.sql** — migration **0011** finance MVP, the approved 8 + 6 adversarial tests:
  cross-wedding isolation; a bride-admin cannot read groom-private line items; co-host/plain-member get
  nothing; allocations cannot exceed or fall short (deferred balance trigger, forced via
  `SET CONSTRAINTS … IMMEDIATE`); 50/50 + unequal settlement arithmetic; payer ≠ responsible; INR and USD
  never summed; the aggregate respects RLS (viewer → complete totals, else empty); **no RLS recursion**
  (42P17) for a family admin; every referenced function present; ₹100 split three ways totals exactly ₹100;
  changing an amount without re-balancing fails at commit; delete cascades cleanly; three groups yield a
  **net position**, not a unique who-pays-whom transfer plan. Plus owner-only writes + direct-write denial.

Every suite runs under the single `scripts/run-sql-suites.sh` command above.

## Deferred to their fast-follow gate (NOT here)
- "consent withdrawal after a message is scheduled" → **outbox** fast-follow.
- Uninvited-instance leakage via bot / exports, magic-link replay across devices → added with the
  guest-facing UI and bot modules.
