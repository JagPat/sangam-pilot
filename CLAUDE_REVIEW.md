# Bounded independent review instruction

Review the current branch against its merge base. This is a release gate, not a new design exercise.

## Settled product decisions

- Sangam records official wedding target/approved costs, commitments, vendor invoices, and payment status.
- Sangam does **not** record family contributions, sources of funds, bank statements, private balances, or
  which family funded an item.
- An event manager operates Cost Control for the wedding as one client unit. A separately appointed
  `cost_approver` authorizes estimates/commitments and verifies official invoices.
- A `wedding_owner` appoints these roles but does not inherit Cost Control access merely by owning the wedding.
- The retired family/private finance schema may remain only for controlled retention; client access and writes
  must be impossible, and private rows must never be copied into Cost Control.

## Review method

1. Inspect the diff and trace every changed authorization path from UI → server action → RPC → table/RLS.
2. Run or inspect the adversarial tests. Verify denials fail for the intended authorization reason.
3. Report only P0/P1 release blockers in changed scope. For each finding include:
   - exact file/function and failure path;
   - why it violates a settled invariant;
   - a reproducible test that currently fails;
   - the smallest concrete fix.
4. Explain the rationale directly. Do not merely prescribe a different design.
5. Do not reopen settled scope, propose unrelated modules, or demand speculative multi-tenant/post-pilot work.
6. If no P0/P1 exists, say exactly: `NO P0/P1 RELEASE BLOCKERS`.

The implementing agent will fix supported P0/P1 findings, rerun the full gate once, and then publish. A new
review round is warranted only when a fix materially changes an authorization boundary.
