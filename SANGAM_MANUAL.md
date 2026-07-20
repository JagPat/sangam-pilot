# Sangam — User & Operator Manual

*Cross-border, two-family Indian wedding platform. This manual covers the live Slice-1: a signed-in guest sees their personalized schedule and RSVPs to each event through a two-step confirm flow, all enforced at the database by Row-Level Security.*

- **Live app:** https://sangam.vitan.in
- **Backend:** Supabase (Postgres + Auth + PostgREST + RLS), project `nlwuzfoumyypuxqcekcw`
- **Source & deploy:** GitHub `JagPat/sangam-pilot` → Coolify auto-deploys `main`
- **Status:** Slice-1 live and verified (see §8). Invite-by-link and WhatsApp flows are built but intentionally off.

---

## 1. What Sangam does today

A guest opens the site, signs in with the email their invitation was sent to, and lands on a schedule showing only the events they are invited to — each with date, time (in that event's own timezone), and venue. Under each event they RSVP **Accept / Decline / Maybe** through a deliberate two-step "propose → confirm" so nothing is recorded until they confirm. Every response is written once, attributed to the person who made it, and audited.

Everything a guest can see or do is scoped by the database itself, not just the UI: one guest can never see another wedding's data, and attendance can only be written through the official command path.

---

## 2. For guests — how to use it

### 2.1 Sign in
1. Go to **https://sangam.vitan.in** and choose **Sign in** (or go straight to `/login`).
2. Enter the email your wedding invitation was sent to.
3. You get in one of two ways:
   - **Sign-in link** — tap "Email me a sign-in link," open the email, tap the link.
   - **Sign-in code** *(most reliable on phones)* — in the **"Already have a code from your email?"** box, type the code from the email and tap **"Sign in with code"** once.
4. You land on **your schedule**.

**Tips**
- The code is single-use: tap "Sign in with code" **once** and wait a second. Tapping again reports "expired" because the first tap already used it.
- If a link opens to a blank/error page, use the **code** instead — codes work in every browser, including the in-app browser email apps open.
- Use the *same* email your invitation went to — that is how the system confirms it is you.

### 2.2 Your schedule
Each event is a card showing the event name and type (e.g. *Sangeet · sangeet*), the date and time in the event's local timezone, and the venue. You only see events you are invited to. If the list is empty, your host may still be finalizing invitations.

### 2.3 RSVP (two steps)
1. Under an event, tap **Accept**, **Decline**, or **Maybe**.
2. The app echoes: *"Mark [event] as [choice]? Nothing is saved until you confirm."*
3. Tap **Confirm** to save, or **Cancel** to back out.
4. The card updates to **Your RSVP: Attending / Not attending / Maybe**.

Change your mind anytime (until the host's RSVP deadline) by choosing again and confirming. If two people answer for the same guest at once, the app asks you to review rather than silently overwriting.

### 2.4 Sign out
Use the sign-out control (posts to `/auth/signout`) to clear your session. Sessions currently last about an hour; you may be asked to sign in again after that (this is being extended — see §10).

---

## 3. Architecture at a glance

```
GitHub (main) ──push──▶ Coolify ──build/deploy──▶ Next.js app (sangam.vitan.in, HTTPS)
                                                        │
                                                        ▼
                                   Supabase: Postgres + GoTrue Auth + PostgREST + RLS
```

The app is Supabase-specific by design (`auth.uid()`, the `anon`/`authenticated`/`service_role` roles, PostgREST RPC wrappers, Row-Level Security). The backend is Supabase — managed cloud today, self-hostable later — not swappable for plain Postgres without a rewrite.

---

## 4. The data model (for operators)

| Object | Meaning |
|---|---|
| `account` | A person's login identity (wedding-agnostic). Linked to a Supabase auth user via `auth_user_id`. |
| `wedding` | The root record. Everything else hangs off a `wedding_id`. |
| `wedding_membership` | Who belongs to a wedding (must be `active` to do anything). |
| `operator_role` | Host powers: `wedding_owner`, `host_group_admin`, `co_host`. |
| `household` → `guest` | Guests live in households. `guest.self_account_id` links a guest to the account that *is* them. |
| `guest_delegation` | Lets one account act for another guest (e.g. a child RSVPing for an elder) — capability-scoped, revocable, expirable. |
| `venue`, `event_function`, `event_instance` | A function (Pithi, Sangeet, Ceremony) has one or more dated instances at a venue, each keeping the original wall-clock time **and** timezone. |
| `invitation` → `invitation_guest` | An invitation invites a household to one event instance; `invitation_guest` is the unit an RSVP attaches to. |
| `event_attendance` | Exactly one row per `invitation_guest`. **Never written directly** — only through `propose_rsvp_change` → `confirm_rsvp_change`. |

**Provenance** is split into two independent facts on every RSVP:
- **channel** — *how* it arrived: `web` (the app), `whatsapp`, or `import`. Set by the trusted server path.
- **authority** — *on what basis* the actor answered: `self`, `delegate`, or `operator`. **Derived** server-side from the relationship, never sent by the client, so it cannot be forged.

---

## 5. Running a wedding (host operations)

> **Guests and invitations are now managed in the app** — see §5.1. The initial wedding *shell* (the wedding row, venues, functions, and dated event instances) is still set up once through the Supabase **SQL Editor** using the service role; the copy-paste template below does that. Generate fresh UUIDs (`gen_random_uuid()` is used inline here so you don't have to).

```sql
-- ===== 1. Wedding =====
with w as (
  insert into app.wedding (title, couple_names, default_timezone, start_date, end_date)
  values ('Our Wedding', 'Aisha & Rohan', 'Asia/Kolkata', '2026-08-14', '2026-08-16')
  returning id
),
-- ===== 2. Host account + membership + owner role =====
-- The host must sign in once first so an auth user exists; put their email here.
acct as (
  insert into app.account (email) values ('host@example.com') returning id
),
mem as (
  insert into app.wedding_membership (wedding_id, account_id, status)
  select w.id, acct.id, 'active' from w, acct returning wedding_id, account_id
),
own as (
  insert into app.operator_role (wedding_id, account_id, role)
  select w.id, acct.id, 'wedding_owner' from w, acct returning wedding_id
),
-- ===== 3. Household + a guest (self_account_id links them to their login) =====
hh as (
  insert into app.household (wedding_id, name)
  select id, 'Patel Household' from w returning id, wedding_id
),
g as (
  insert into app.guest (wedding_id, household_id, self_account_id, full_name)
  select w.id, hh.id, acct.id, 'Guest Name' from w, hh, acct returning id, wedding_id
),
-- ===== 4. Venue + function + a dated instance =====
v as (
  insert into app.venue (wedding_id, name, iana_timezone)
  select id, 'The Grand Palace', 'Asia/Kolkata' from w returning id, wedding_id
),
f as (
  insert into app.event_function (wedding_id, name, type)
  select id, 'Sangeet', 'sangeet' from w returning id, wedding_id
),
ei as (
  insert into app.event_instance (wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status)
  select w.id, f.id, v.id, 'Asia/Kolkata',
         row('2026-08-15 19:00:00+05:30'::timestamptz, '2026-08-15 19:00:00'::timestamp, 330, 'host')::app.zoned_time,
         'scheduled'
  from w, f, v returning id, wedding_id
),
-- ===== 5. Invitation (status 'sent' = RSVP open) + invitation_guest =====
inv as (
  insert into app.invitation (wedding_id, household_id, event_instance_id, status, rsvp_deadline_at)
  select w.id, hh.id, ei.id, 'sent', '2026-08-10 23:59:59+05:30'
  from w, hh, ei returning id, wedding_id, event_instance_id
)
insert into app.invitation_guest (wedding_id, invitation_id, event_instance_id, guest_id)
select inv.wedding_id, inv.id, inv.event_instance_id, g.id from inv, g;
```

Key rules when seeding:
- An invitation must be **`status = 'sent'`** (not `draft`/`closed`) and within `rsvp_deadline_at` for RSVP to be open.
- `event_instance.arrival` is a composite `app.zoned_time` = `row(instant, wall_local, offset_minutes, source)`. Use the real UTC offset in minutes (IST = 330, US-Eastern = −300).
- **Guest sign-in is now automatic.** You no longer wire `self_account_id` by hand: when a guest signs in with the email you gave them, the app binds their new login to their guest record (and activates their membership) on the spot, matching on the OTP-verified email. See §5.1 for the no-SQL way to add guests and their emails.

### 5.1 Managing guests & invitations (no SQL)

Open **sangam.vitan.in/host** and click **Manage guests & invitations** (top right). From there, entirely in the app, you can:

- **Add a guest** — name + the email their invite will go to, into an existing or brand-new household.
- **Edit a guest** — change their name or sign-in email (expand *Edit* on their row).
- **Invite / remove** — a guest × event grid: click **Invite** to invite a guest to an event (this opens RSVP for them), or **Remove** to take them off an event they have not answered yet. A guest who has already responded shows a 🔒 and cannot be removed, so their RSVP and its audit trail are never lost.
- **Delete a guest** — available once they are not on any event.

Every write runs as *you* (the owner) under the database's row-level security, so you can only ever touch your own wedding. When a guest you added signs in with that email, they are linked automatically and land on their schedule. Setting up the wedding's venues and events is still SQL today (§5) — those screens are the next step.

---

## 6. Why RSVP is two steps

RSVP flows through exactly two database functions, and **only** these:

```
propose_rsvp_change(invitation_guest, status)   -- creates a pending proposal; writes NOTHING to attendance
      │  app echoes "Mark X as Y? confirm?"
      ▼
confirm_rsvp_change(proposal, expected_version?) -- transactionally writes attendance + change-log + audit
```

This gives four guarantees: nothing is recorded until the guest confirms; the acting **authority is derived** at confirm time (a delegation that lapsed mid-flow can't leave a stale label); **optimistic concurrency** (`expected_version`) stops a guest and a proxy silently clobbering each other; and every confirm appends a structured **audit** row. The web app and the future WhatsApp bot call the *same* two functions, so the rules can't drift between channels.

---

## 7. Security model (what each role can see)

Every table has Row-Level Security enabled and **denies by default** — a policy must explicitly allow a read or write.

- **anon** (not signed in): no access to any `app` data and cannot execute any `app` function. Verified: all functions report `anon = false`, including the account self-link (service-only).
- **guest** (signed in): sees only their own guest record, the events they're invited to, and their own RSVPs. Writes RSVPs only via the two-step commands.
- **delegate**: an account with an active, unexpired `guest_delegation` can act for another guest — same rules, attributed as `delegate`.
- **captain**: can see their assigned household.
- **wedding_owner**: sees and manages the whole wedding; aggregate reports (headcounts, caterer report) are **owner-only** and return *empty* (never a partial total) to anyone else.
- **service_role** (server only): the trusted path used by the invite-exchange and seeding; bypasses RLS. Never exposed to the browser.

Recipient-bound **access links** (the invite-exchange flow) are hashed, single-use, and bound to the exact contact they were issued to — a forwarded link opened by a different account is rejected and never reveals the guest's name. This flow is built and now works on Supabase (fixed in migration 0008) but stays **off** (`INVITE_EXCHANGE_ENABLED=0`) until email OTP is proven end-to-end.

---

## 8. What is verified working (certified state)

Run on the live database and deployment on 2026-07-19:

| Area | Result |
|---|---|
| App routes | `/` 200 · `/login` 200 · `/schedule` gates to login · `/auth/callback` handled · `/invite/*` 404 (flag off) · signout 303 — all over HTTPS |
| Sign-in | Email link **and** typed code both establish a session (code path is prefetch-proof) |
| Schedule read | Authenticated guest reads their 3 events over the API (RLS-scoped); composite time type deserializes |
| RSVP loop | Real browser RSVPs recorded: Pithi *accepted*, Sangeet *tentative*, Ceremony *declined* — each `via web`, `authority self` |
| Two-step + audit | 3 confirmed proposals, 3 change-log rows, 3 structured audit rows |
| Function surface | `anon` locked out of all functions; `authenticated` limited to the RLS helpers + RSVP wrappers; the account self-link is `service_role`-only; `service_role` full |
| Adversarial suite | **ALL PASSED** — cross-wedding isolation, aggregate-view scoping, direct-write denial, closed/expired/past-deadline rejection, derived authority, cross-actor-confirm rejection, single-pending-proposal, recipient-bound single-use access links |
| Organizer management (2026-07-20) | Owner adds a guest + email and invites them at `/host/manage` (owner-session writes under RLS, not service role); the guest signs in and is **auto-linked by verified email**; a non-owner sees 0 rows and is denied writes — all verified live |

---

## 9. Operations

- **Deploy:** push to `main` → Coolify rebuilds and redeploys. Base directory `app/`, port 3000.
- **Schema changes:** add a new numbered file in `supabase/migrations/` (never edit an applied one). Latest applied is `0008_fix_pgcrypto_search_path`.
- **Release gate:** the SQL suites in `supabase/tests/` (run as `anon`/`authenticated`/`service_role`) are the certification; keep them green before real-guest rollout.
- **Env vars (server only):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INVITE_EXCHANGE_ENABLED=0`. The service-role key must never be a `NEXT_PUBLIC_*` var.
- **Rotate secrets** after go-live: Coolify root token, Supabase `service_role` key, DB password.

---

## 10. Known limitations & roadmap

- **Session length** — currently ~1 hour; extend so guests aren't re-signing-in mid-event (Auth setting).
- **Guest self-serve email code** — put the code into the outgoing sign-in email template so guests don't need a host to generate one; add a production SMTP sender. (Both are Supabase Auth settings.)
- **Host/admin screens** — **guests & invitations are now in-app** (§5.1). Still SQL: creating the wedding shell (venues, functions, event instances) — a setup screen for those is the next step.
- **Invite-by-link exchange** — built and now Supabase-compatible, still gated off until email OTP is verified end-to-end.
- **WhatsApp bot** — a fast-follow that calls the same `propose`/`confirm` functions.
- **Deploy cleanup** — the `next start` vs `output: standalone` log warning is cosmetic; fold into a future push.

---

*Questions or changes: the source of truth is the repo (`docs/adr/0001` for locked decisions, `DEPLOY.md` for the runbook). This manual describes the deployed Slice-1 as verified on 2026-07-19.*
