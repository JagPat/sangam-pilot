# Event Manager Onboarding Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform-approved event manager sign in, create a client wedding, and enter the correct organizer workspace without misleading forms, manual SQL, or person-specific authorization.

**Architecture:** Keep `event_manager` wedding-scoped and keep the existing `account.can_create_wedding` as the small pilot's account-level creator entitlement. Add a platform-super-admin provisioning RPC/UI, make wedding creation atomically grant `wedding_owner` plus `event_manager`, and make post-login/setup UI depend on the real entitlement. Authentication remains Supabase email OTP with persistent refreshed sessions; authorization is derived from the linked account and database roles.

**Tech Stack:** Next.js 15 server components/actions, TypeScript, Supabase Auth, PostgreSQL 16, RLS, Vitest, Playwright smoke scripts.

## Global Constraints

- No person's name or email may appear in reusable authorization logic, schema policies, navigation, or UI copy.
- A wedding-scoped `event_manager` assignment must not grant permission to create unrelated weddings.
- Only `platform_super_admin` may grant or revoke the account-level creator entitlement.
- Wedding creation must atomically grant the creator `wedding_owner` and `event_manager` for the new wedding.
- Session identity comes only from verified Supabase `auth.getUser()` / `auth.uid()` paths.
- The UI must not display a wedding-creation form when the database will reject the account.
- Do not weaken the existing persistent-session or RLS gates.

---

## Verified defect

Migration `0030_wedding_creation_gate.sql` defaults `account.can_create_wedding` to `false` and rejects `create_wedding` unless it is true. `link_signed_in_account` creates first-time accounts with that default. No application RPC or screen grants the capability, while `/host` and `/host/setup` tell any signed-in account with no owned wedding that it can create one. The existing `07_owner_setup.sql` suite reproduces this exact denial only after manually provisioning its success fixture.

The wedding-scoped `event_manager` role currently adds only the Costs navigation item. It is not the role used by the owner-scoped setup, guest, venue, event, stay, and vendor loaders. Therefore a planner creating a wedding must receive both roles rather than replacing `wedding_owner` with `event_manager`.

## File map

- Create `supabase/migrations/20260728120000_0036_event_manager_onboarding.sql` — platform provisioning, capability query, and atomic dual-role wedding creation.
- Create `supabase/tests/18_event_manager_onboarding.sql` — adversarial database coverage.
- Create `app/lib/data/creator-access.ts` and `.test.ts` — session-account creator read model and UI decision.
- Modify `app/lib/auth/landing.ts` and `.test.ts` — route approved creators with no wedding to setup.
- Modify `app/app/auth/callback/route.ts` — use creator-aware landing after account linking.
- Modify `app/app/login/page.tsx` and `app/lib/auth/loginDecision.ts` tests — preserve creator-aware automatic return.
- Modify `app/app/host/page.tsx` and `app/app/host/setup/page.tsx` — capability-honest empty states.
- Create `app/lib/data/platform.ts` — platform-super-admin read model.
- Create `app/app/host/platform/page.tsx`, `actions.ts`, and page/action tests — provision planner creator access by email.
- Modify `app/lib/data/nav.ts` and `.test.ts`, `app/app/host/HostNav.tsx` — platform section plus correct union of creator roles.
- Modify `app/lib/database.types.ts` — exact RPC and row types.
- Create `app/scripts/verify-event-manager-onboarding.mjs` — real Supabase Auth journey.
- Modify `app/package.json`, `app/README.md`, `VALIDATION.md`, and `DEPLOY.md` — commands and operator runbook.

---

### Task 1: Database creator entitlement and atomic dual-role creation

**Files:**
- Create: `supabase/migrations/20260728120000_0036_event_manager_onboarding.sql`
- Create: `supabase/tests/18_event_manager_onboarding.sql`

**Interfaces:**
- Produces: `app.current_account_can_create_wedding() returns boolean`
- Produces: `app.super_admin_set_wedding_creator(text, boolean) returns uuid`
- Replaces: `app.create_wedding(text,text,text,date,date) returns uuid`

- [ ] **Step 1: Write the failing adversarial SQL suite**

Create fixtures for a platform super-admin, an approved planner, an invited event manager without creator access, and an unrelated account. Assert this contract:

```sql
-- Super-admin can pre-provision an unlinked email.
select app.super_admin_set_wedding_creator('planner@example.test', true);

-- After the verified auth user adopts that account, capability is true.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'planner_auth_id')::text, true);
select app.current_account_can_create_wedding(); -- true

-- Creation grants both wedding roles atomically.
select app.create_wedding('Planner-created wedding', null, 'Asia/Kolkata', null, null) \gset
select count(*) = 2
  from app.operator_role
 where wedding_id = :'create_wedding'
   and role::text in ('wedding_owner','event_manager');

-- Wedding-scoped assignment alone is not creator entitlement.
select app.current_account_can_create_wedding(); -- false for invited manager fixture
```

Also assert that `anon`, an unrelated authenticated account, and a non-super-admin cannot execute the provisioning RPC; disabling the entitlement immediately blocks another creation; and cross-wedding roles do not satisfy the account-level check.

- [ ] **Step 2: Run the suite and verify it fails before migration 0036**

Run:

```bash
dropdb --if-exists sangam_onboarding_plan
createdb sangam_onboarding_plan
DATABASE_URL=postgres:///sangam_onboarding_plan bash scripts/run-sql-suites.sh
```

Expected: migration/suite failure because the two new functions do not exist and `create_wedding` grants only `wedding_owner`.

- [ ] **Step 3: Add the capability and provisioning functions**

The migration must use these signatures and privilege boundaries:

```sql
create or replace function app.current_account_can_create_wedding()
returns boolean language sql stable security definer set search_path=app,public as $$
  select exists (
    select 1 from app.account a
     where a.id=app.current_account_id() and a.can_create_wedding
  );
$$;

create or replace function app.super_admin_set_wedding_creator(p_email text,p_enabled boolean)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_email text:=lower(trim(coalesce(p_email,''))); v_account uuid;
begin
  if not app.is_platform_super_admin() then
    raise exception 'platform administrator required' using errcode='42501';
  end if;
  if v_email='' or position('@' in v_email)=0 then raise exception 'valid email required'; end if;
  select id into v_account from app.account where lower(trim(email))=v_email
   order by (auth_user_id is not null) desc,created_at asc limit 1 for update;
  if v_account is null then
    insert into app.account(email,can_create_wedding) values(v_email,p_enabled) returning id into v_account;
  else
    update app.account set can_create_wedding=p_enabled,updated_at=now() where id=v_account;
  end if;
  return v_account;
end $$;
```

Recreate `app.create_wedding` with the existing validation and inserts, then add:

```sql
insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
  (v_wed,v_acc,'wedding_owner',null),
  (v_wed,v_acc,'event_manager',null);
```

Revoke both new functions from `PUBLIC` and `anon`; grant the capability query and provisioning command only to `authenticated`. The provisioning function performs its own super-admin check.

- [ ] **Step 4: Run the SQL suites**

Run the Task 1 database command again. Expected: all suites, including `18_event_manager_onboarding.sql`, pass.

- [ ] **Step 5: Commit the database contract**

```bash
git add supabase/migrations/20260728120000_0036_event_manager_onboarding.sql supabase/tests/18_event_manager_onboarding.sql
git commit -m "fix: make planner wedding creation provisioned and atomic"
```

---

### Task 2: Capability-aware landing and setup UI

**Files:**
- Create: `app/lib/data/creator-access.ts`
- Create: `app/lib/data/creator-access.test.ts`
- Modify: `app/lib/auth/landing.ts`
- Modify: `app/lib/auth/landing.test.ts`
- Modify: `app/lib/auth/loginDecision.ts`
- Modify: `app/lib/auth/loginDecision.test.ts`
- Modify: `app/app/login/page.tsx`
- Modify: `app/app/auth/callback/route.ts`
- Modify: `app/app/host/page.tsx`
- Modify: `app/app/host/setup/page.tsx`

**Interfaces:**
- Produces: `getCreatorAccess(db): Promise<{canCreateWedding:boolean}>`
- Produces: `postAuthDestination(next, sections, canCreateWedding): string`

- [ ] **Step 1: Write failing pure decision tests**

Use these cases:

```ts
expect(postAuthDestination(null, [], true)).toBe('/host/setup');
expect(postAuthDestination(null, [{href:'/host/cost-control'}], false)).toBe('/host/cost-control');
expect(postAuthDestination(null, [], false)).toBe('/schedule');
expect(canRenderWeddingCreation({canCreateWedding:true})).toBe(true);
expect(canRenderWeddingCreation({canCreateWedding:false})).toBe(false);
```

- [ ] **Step 2: Run tests and verify the creator case fails**

```bash
cd app
npm test -- lib/auth/landing.test.ts lib/auth/loginDecision.test.ts lib/data/creator-access.test.ts
```

Expected: FAIL because creator access is not part of the landing/UI decisions.

- [ ] **Step 3: Implement the creator read model**

`getCreatorAccess` calls `app.current_account_can_create_wedding` through the user-scoped client and returns false on a null result; database errors must be thrown so pages can render an explicit unavailable state rather than incorrectly showing the form.

- [ ] **Step 4: Make authentication landing creator-aware**

Change `postAuthDestination` to:

```ts
export function postAuthDestination(
  nextParam: string|null|undefined,
  sections: readonly DestinationSection[],
  canCreateWedding = false,
): string {
  const roleDefault = sections[0]?.href ?? (canCreateWedding ? '/host/setup' : '/schedule');
  return nextParam == null ? roleDefault : safeInternalPath(nextParam, roleDefault);
}
```

After account linking, both the callback and `/login` query organizer navigation and creator access. Existing-session users continue bypassing OTP; a newly approved planner with no wedding lands on setup.

- [ ] **Step 5: Remove the misleading creation form**

`/host/setup` renders `CreateWeddingForm` only when `canCreateWedding` is true. Otherwise it renders:

> Your sign-in is working, but this account has not been approved to create client weddings. Ask a Sangam platform administrator to enable event-manager onboarding for this email.

`/host` uses the same decision and never links an unprovisioned account to a form that the database will reject.

- [ ] **Step 6: Run focused and full application tests**

```bash
cd app
npm test -- lib/auth/landing.test.ts lib/auth/loginDecision.test.ts lib/data/creator-access.test.ts
npm test
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit the honest onboarding UI**

```bash
git add app/lib/data/creator-access.ts app/lib/data/creator-access.test.ts app/lib/auth/landing.ts app/lib/auth/landing.test.ts app/lib/auth/loginDecision.ts app/lib/auth/loginDecision.test.ts app/app/login/page.tsx app/app/auth/callback/route.ts app/app/host/page.tsx app/app/host/setup/page.tsx
git commit -m "fix: align planner landing with wedding creator access"
```

---

### Task 3: Platform administrator provisioning screen

**Files:**
- Create: `app/lib/data/platform.ts`
- Create: `app/app/host/platform/page.tsx`
- Create: `app/app/host/platform/actions.ts`
- Create: `app/app/host/platform/page.test.tsx`
- Modify: `app/lib/data/nav.ts`
- Modify: `app/lib/data/nav.test.ts`
- Modify: `app/app/host/HostNav.tsx`
- Modify: `app/lib/database.types.ts`

**Interfaces:**
- Consumes: `app.super_admin_set_wedding_creator(text,boolean)`
- Produces: platform-only `/host/platform` workflow

- [ ] **Step 1: Write failing navigation and rendering tests**

Assert a platform super-admin sees `Platform` and a normal wedding owner/event manager does not. Assert the screen labels the capability “May create client weddings,” not “event_manager role,” and contains enable/disable forms keyed by email.

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
cd app
npm test -- lib/data/nav.test.ts app/host/platform/page.test.tsx
```

- [ ] **Step 3: Implement platform data and server action**

The server action normalizes email and calls only:

```ts
await app.rpc('super_admin_set_wedding_creator', {
  p_email: email,
  p_enabled: enabled,
});
```

It derives the acting administrator from the session/RPC and never accepts an actor or role from the form. Add exact generated-style RPC types to `database.types.ts`.

- [ ] **Step 4: Add platform navigation without conflating wedding roles**

Extend organizer navigation with a separately queried `is_platform_super_admin()` capability. Do not infer it from `wedding_owner`, `event_manager`, or email.

- [ ] **Step 5: Verify and commit**

```bash
cd app
npm test
npm run typecheck
git add app/lib/data/platform.ts app/app/host/platform app/lib/data/nav.ts app/lib/data/nav.test.ts app/app/host/HostNav.tsx app/lib/database.types.ts
git commit -m "feat: provision wedding creators from platform console"
```

---

### Task 4: Real-auth onboarding regression gate

**Files:**
- Create: `app/scripts/verify-event-manager-onboarding.mjs`
- Modify: `app/package.json`
- Modify: `app/README.md`
- Modify: `VALIDATION.md`
- Modify: `DEPLOY.md`

**Interfaces:**
- Produces: `npm run verify:event-manager-onboarding`

- [ ] **Step 1: Write the real Supabase journey script**

Using service role only for fixture creation/cleanup and the anon client for user actions, the script must:

1. create and confirm a disposable platform-admin auth user/account;
2. create an unlinked planner account by calling the authenticated provisioning RPC as that admin;
3. create/confirm the planner auth user with the same email and call the existing service-only linker;
4. sign in through the anon client;
5. assert creator capability is true;
6. call `create_wedding` as the planner;
7. assert user-scoped reads return both `wedding_owner` and `event_manager` roles;
8. create an unprovisioned disposable account and assert wedding creation returns `42501`; and
9. delete the disposable wedding, app accounts, and auth users in `finally`.

- [ ] **Step 2: Add the package command**

```json
"verify:event-manager-onboarding": "node scripts/verify-event-manager-onboarding.mjs"
```

- [ ] **Step 3: Run all local gates**

```bash
dropdb --if-exists sangam_onboarding_final
createdb sangam_onboarding_final
DATABASE_URL=postgres:///sangam_onboarding_final bash scripts/run-sql-suites.sh
cd app
npm ci
npm test
npm run typecheck
npm run build
```

Expected: every command exits 0 and `.next/BUILD_ID` exists.

- [ ] **Step 4: Run against `supabase start`**

```bash
npx supabase@latest start
npx supabase@latest db reset
eval "$(npx supabase@latest status -o env)"
cd app
npm run verify:event-manager-onboarding
```

Expected: `EVENT MANAGER ONBOARDING GATE PASSED`.

- [ ] **Step 5: Commit the certification harness**

```bash
git add app/scripts/verify-event-manager-onboarding.mjs app/package.json app/package-lock.json app/README.md VALIDATION.md DEPLOY.md
git commit -m "test: certify event manager onboarding"
```

---

### Task 5: Production rollout and live smoke

**Files:**
- Modify only if evidence requires it: `DEPLOY.md`

- [ ] **Step 1: Push migrations before application deployment**

```bash
npx supabase@latest link --project-ref nlwuzfoumyypuxqcekcw
npx supabase@latest db push --linked
npx supabase@latest migration list --linked
```

Expected: local and remote include migration `0036`.

- [ ] **Step 2: Deploy the matching application commit**

Push the reviewed branch/PR and confirm Coolify deploys that exact commit SHA.

- [ ] **Step 3: Perform the live planner journey**

Through `https://sangam.vitan.in`:

1. platform admin enables a disposable planner email;
2. planner signs in once through email OTP;
3. `/login` redirects without another OTP while the session remains valid;
4. planner lands on `/host/setup` and creates a disposable wedding;
5. navigation includes owner setup modules and Cost Control access;
6. planner cannot approve costs without `cost_approver` when that module lands; and
7. platform admin disables creator access and cleanup removes the disposable wedding/user.

- [ ] **Step 4: Record evidence**

Record deployed SHA, migration list, time, disposable account identifier, and pass/fail results in `VALIDATION.md`. Do not record OTPs, access tokens, cookies, or service keys.

- [ ] **Step 5: Commit any evidence-only documentation update**

```bash
git add VALIDATION.md DEPLOY.md
git commit -m "docs: record live event manager onboarding gate"
```
