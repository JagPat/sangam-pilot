# ADR 0001 — Slice-1 locked decisions

- Status: **Accepted** (locked)
- Date: 2026-07-17
- Context: v8 of the Slice-1 scaffold was accepted as the foundation after successive security reviews
  (identity boundary, RLS, RSVP command path, provenance model, recipient-bound invite exchange). This ADR
  freezes the decisions that came out of that process so implementation can proceed without re-opening them.

## Decision

The following are **locked**. Do not re-litigate them in code review or reopen them with speculative
schema changes. Changing any of them requires a new ADR that supersedes this one, justified by a concrete
failing test or a real contradiction discovered during implementation.

1. **`INVITE_EXCHANGE_ENABLED` stays OFF** until (a) OTP/magic-link authentication is integrated and (b)
   the real Supabase-local authorization tests pass (anon/authenticated/service_role against real
   `supabase start`). The invite route returns 404 while the flag is unset/`0`.

2. **Pilot access links are email-only and self-binding only.** A link is issued only to the guest's own
   designated self email and binds that guest's `self_account_id`. Self-binding links are **not** issued to
   proxies, children, captains, or household coordinators.

3. **Proxy operation uses `guest_delegation`.** Automated proxy onboarding is **deferred** and must **not**
   reuse the guest self-binding link flow. A proxy is granted via a delegation row, not by redeeming a
   self-binding invite.

4. **Exact issue-time contact binding is intentional.** Redemption (and name disclosure) requires the
   verified session contact to match the *specific* contact the link was issued to. Redemption through any
   other household contact is **not** allowed. (Do not relax this to "match any on-file contact.")

5. **WhatsApp/import RSVP actor context is deferred** until those modules are built. The current functions
   must continue to **fail closed** when there is no mapped `auth.uid()` (a raw service-role call cannot
   derive an acting authority and cannot pass the confirmer check). Those modules must establish an explicit
   trusted acting-account context when built.

6. **Accept v8's database model as-is.** Cross-actor confirmation guard, structured RSVP audit
   (`channel`/`authority` columns + CHECK), recipient-contact checks, RLS policies, and the identity/event/
   RSVP model are accepted **without further redesign**.

7. **Supabase-local certification is a release gate, not a coding blocker.** Run the four SQL suites against
   real `supabase start` (or in CI on a Docker-enabled machine) before real guests. Slice-1 application
   implementation proceeds now against the accepted migrations and command functions.

## Consequences

- The vertical slice (signed-in guest → personalized schedule → invitation-authorized RSVP proposal →
  explicit confirmation → persisted attendance → updated display) is built now against the existing
  migrations and the `propose_rsvp_change` / `confirm_rsvp_change` functions. Application code never writes
  `event_attendance` directly and never bypasses the two-step command path.
- Before the invite exchange is enabled, the following must land: Supabase email OTP/magic-link auth;
  confirmed-email assurance; matching the confirmed email against the link's intended self email; and the
  real Supabase-local role tests passing.
- This sandbox has no Docker, so `supabase start` cannot run here. The SQL suites are exercised against a
  throwaway PostgreSQL 16 cluster with the documented auth stub as an interim signal; the real-auth run
  remains the release gate on a Docker-enabled machine or CI.
