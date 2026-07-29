## Outcome

<!-- State the user-visible result, not the implementation activity. -->

## Locked product boundaries

- [ ] No family contribution, source-of-funds, bank-statement, or private-balance data was added.
- [ ] Event-manager operational authority and cost-approver decision authority remain separate.
- [ ] Identity, wedding scope, and actor attribution are derived server-side.
- [ ] New database writes use guarded RPCs; direct authenticated DML remains denied.

## Evidence

- [ ] SQL authorization suites pass.
- [ ] Real Supabase auth/PostgREST gate passes.
- [ ] App tests, typecheck, lint, and production build pass.
- [ ] New behavior has an adversarial regression test.

## Reviewer contract

Review only changed behavior and its security/data boundaries. Report P0/P1 defects with a reproducible
failure path, the violated invariant, and the smallest concrete correction. Do not reopen settled product
scope or request speculative post-pilot architecture in this delivery PR.
