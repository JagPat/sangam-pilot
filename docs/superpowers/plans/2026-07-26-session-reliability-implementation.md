# Session Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a guest authenticate once and return to Sangam after a browser restart without entering an email or OTP again, while redirecting already-authenticated users away from `/login`.

**Architecture:** Keep Supabase's rotating access/refresh-token session as the trusted-browser credential; do not add device fingerprinting or a second session system. Centralize persistent cookie options, keep middleware as the only refresh writer, extract one safe post-auth destination resolver, and verify persistence against a real deployed Supabase project with a disposable Auth user and a persistent Chromium profile.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Supabase Auth/SSR, Vitest, Playwright Chromium, GitHub Actions.

## Global Constraints

- This plan implements only Phase 1 of `docs/superpowers/specs/2026-07-26-senior-friendly-guest-access-design.md`.
- Do not implement Telegram, assisted activation, `account_identity`, guest cutoff, or passkeys in this plan.
- Do not use browser/hardware fingerprinting.
- Access tokens stay short-lived; refresh-token cookies persist for 400 days while Supabase controls actual session validity.
- Identity always comes from `supabase.auth.getUser()`, never query parameters, form fields, or `getSession()`.
- Middleware remains the only refresh-cookie writer for ordinary page requests and must propagate rotated cookies to both request and response.
- Preserve same-origin redirect protection: paths must begin with one `/` and must not begin with `//`.
- Never log access tokens, refresh tokens, OTPs, raw cookies, email addresses, or service-role keys.
- `INVITE_EXCHANGE_ENABLED` remains unchanged and off unless its existing release gate is separately satisfied.
- Every task ends with tests and a focused commit; do not push or deploy a failing commit.

## File map

- Create `app/vitest.config.ts` — unit-test configuration and `@/` alias.
- Modify `app/package.json` and `app/package-lock.json` — add Vitest/Playwright and test scripts.
- Create `app/lib/auth/landing.ts` — the sole safe post-auth destination policy.
- Create `app/lib/auth/landing.test.ts` — destination and open-redirect unit tests.
- Create `app/lib/auth/sessionState.ts` and `.test.ts` — non-sensitive session failure classification.
- Modify `app/lib/auth/session.ts` — return a reason when a protected request has no usable session.
- Modify `app/app/login/page.tsx` — redirect a valid existing session before rendering login controls.
- Modify `app/app/auth/callback/route.ts` — reuse the destination policy.
- Create `app/app/login/page.test.tsx` — authenticated/anonymous login-page behavior.
- Create `app/lib/supabase/authCookieOptions.ts` — shared persistent cookie settings.
- Modify `app/lib/supabase/clients.ts` — apply the shared cookie settings to user clients.
- Modify `app/lib/supabase/middleware.ts` — apply the same settings while preserving refresh propagation.
- Create `app/lib/supabase/middleware.test.ts` — adversarial rotation and persistence assertions.
- Create `app/scripts/verify-session-persistence.mjs` — live/staging persistent-browser certification.
- Modify `.github/workflows/ci.yml` — run unit tests before typecheck/build.
- Modify `app/README.md`, `VALIDATION.md`, and `DEPLOY.md` — operating and release instructions.

---

### Task 1: Add the unit-test harness

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/vitest.config.ts`

**Interfaces:**
- Consumes: existing TypeScript alias `@/* -> ./*` from `app/tsconfig.json`.
- Produces: `npm test` for one-shot CI and `npm run test:watch` for local development.

- [ ] **Step 1: Install test dependencies**

Run:

```bash
cd app
npm install --save-dev vitest playwright
```

Expected: `package.json` and `package-lock.json` change; `npm audit` reports zero high/critical vulnerabilities.

- [ ] **Step 2: Add deterministic scripts**

Set the `scripts` portion of `app/package.json` to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "verify:session": "node scripts/verify-session-persistence.mjs"
}
```

Keep the existing `dev`, `build`, `start`, and `typecheck` scripts unchanged.

- [ ] **Step 3: Create `app/vitest.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
});
```

- [ ] **Step 4: Prove the empty harness runs**

Run:

```bash
cd app
npm test -- --passWithNoTests
npm audit --audit-level=high
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/vitest.config.ts
git commit -m "test: add app unit test harness"
```

---

### Task 2: Centralize safe post-auth routing

**Files:**
- Create: `app/lib/auth/landing.ts`
- Create: `app/lib/auth/landing.test.ts`

**Interfaces:**
- Consumes: organizer navigation sections shaped as `{ href: string }[]`.
- Produces: `safeInternalPath(value, fallback)` and `postAuthDestination(nextParam, sections)`.

- [ ] **Step 1: Write the failing destination tests**

Create `app/lib/auth/landing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { postAuthDestination, safeInternalPath } from './landing';

describe('safeInternalPath', () => {
  it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)', 'schedule']) (
    'rejects %s',
    (value) => expect(safeInternalPath(value, '/schedule')).toBe('/schedule'),
  );

  it('accepts an internal path with query and fragment', () => {
    expect(safeInternalPath('/schedule?day=2#event', '/schedule')).toBe('/schedule?day=2#event');
  });
});

describe('postAuthDestination', () => {
  it('honors a safe explicit destination', () => {
    expect(postAuthDestination('/directory', [{ href: '/host' }])).toBe('/directory');
  });

  it('rejects an unsafe explicit destination', () => {
    expect(postAuthDestination('//evil.example', [{ href: '/host' }])).toBe('/host');
  });

  it('uses the first authorized organizer section when no destination was requested', () => {
    expect(postAuthDestination(null, [{ href: '/host/manage' }])).toBe('/host/manage');
  });

  it('uses the guest schedule when no organizer section exists', () => {
    expect(postAuthDestination(undefined, [])).toBe('/schedule');
  });
});
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
cd app
npm test -- lib/auth/landing.test.ts
```

Expected: FAIL because `./landing` does not exist.

- [ ] **Step 3: Implement the minimal routing policy**

Create `app/lib/auth/landing.ts`:

```ts
type DestinationSection = { href: string };

export function safeInternalPath(value: string | null | undefined, fallback = '/schedule'): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

export function postAuthDestination(
  nextParam: string | null | undefined,
  sections: readonly DestinationSection[],
): string {
  const roleDefault = sections[0]?.href ?? '/schedule';
  return nextParam == null ? roleDefault : safeInternalPath(nextParam, roleDefault);
}
```

- [ ] **Step 4: Run the focused and full unit suites**

Run:

```bash
cd app
npm test -- lib/auth/landing.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/landing.ts app/lib/auth/landing.test.ts
git commit -m "test: define safe post-auth routing"
```

---

### Task 3: Redirect already-authenticated visitors

**Files:**
- Modify: `app/app/login/page.tsx`
- Modify: `app/app/auth/callback/route.ts`
- Modify: `app/lib/auth/session.ts`
- Create: `app/lib/auth/sessionState.ts`
- Create: `app/lib/auth/sessionState.test.ts`
- Create: `app/app/login/page.test.tsx`

**Interfaces:**
- Consumes: `getVerifiedUser()`, `pageClient()`, `getOrganizerNav()`, and `postAuthDestination()`.
- Produces: `/login` renders only for anonymous users; authenticated users reach a safe role-aware destination;
  protected redirects distinguish `no_cookie` from `refresh_failed` without logging cookie values.

- [ ] **Step 1: Write the failing login-page tests**

Create `app/app/login/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getOrganizerNav: vi.fn(),
  pageClient: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/session', () => ({ getVerifiedUser: mocks.getVerifiedUser }));
vi.mock('@/lib/data/nav', () => ({ getOrganizerNav: mocks.getOrganizerNav }));
vi.mock('@/lib/supabase/pageClient', () => ({ pageClient: mocks.pageClient }));
vi.mock('./actions', () => ({ sendMagicLink: vi.fn(), verifyCode: vi.fn() }));

import LoginPage from './page';

describe('LoginPage', () => {
  beforeEach(() => {
    mocks.pageClient.mockResolvedValue({});
    mocks.getOrganizerNav.mockResolvedValue({ email: null, roleLabel: null, sections: [] });
  });

  it('redirects an authenticated guest without asking for another OTP', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'u1', email: 'guest@example.test', emailConfirmed: true });
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/schedule');
  });

  it('honors a safe requested destination for an authenticated user', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'u1', email: 'guest@example.test', emailConfirmed: true });
    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: '/directory' }) }),
    ).rejects.toThrow('REDIRECT:/directory');
  });

  it('renders login controls for an anonymous visitor', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null);
    const result = await LoginPage({ searchParams: Promise.resolve({}) });
    expect(result).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd app
npm test -- app/login/page.test.tsx
```

Expected: authenticated cases FAIL because the page renders instead of redirecting.

- [ ] **Step 3: Add authenticated redirect before rendering the login form**

In `app/app/login/page.tsx`, import:

```ts
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth/session';
import { postAuthDestination } from '@/lib/auth/landing';
import { getOrganizerNav } from '@/lib/data/nav';
import { pageClient } from '@/lib/supabase/pageClient';
```

Immediately after awaiting `searchParams`, add:

```ts
const user = await getVerifiedUser();
if (user) {
  let sections: { href: string }[] = [];
  try {
    sections = (await getOrganizerNav(await pageClient())).sections;
  } catch {
    // Authentication succeeded; navigation enrichment is best-effort.
  }
  redirect(postAuthDestination(next ?? null, sections));
}
```

Keep the anonymous form and its copy otherwise unchanged.

- [ ] **Step 4: Replace callback routing duplication**

In `app/app/auth/callback/route.ts`:

- import `postAuthDestination`;
- remove the local `rawNext`/`next` validation;
- after authentication and account linking, load organizer sections only when `nextParam == null`;
- set `dest = postAuthDestination(nextParam, sections)`;
- keep the relative `Location` response and existing contact binding unchanged.

The resulting decision block must be:

```ts
let sections: { href: string }[] = [];
if (nextParam == null) {
  try {
    sections = (await getOrganizerNav(supabase as unknown as AppSupabaseClient)).sections;
  } catch {
    // Fall back to the guest schedule.
  }
}
return redirectTo(postAuthDestination(nextParam, sections));
```

- [ ] **Step 5: Write the failing session-state tests**

Create `app/lib/auth/sessionState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sessionFailureReason } from './sessionState';

describe('sessionFailureReason', () => {
  it('reports no_cookie when no Supabase credential exists', () => {
    expect(sessionFailureReason([])).toBe('no_cookie');
  });

  it('reports refresh_failed without exposing the cookie value', () => {
    expect(sessionFailureReason([{ name: 'sb-project-auth-token.0', value: 'secret' }])).toBe('refresh_failed');
  });

  it('ignores empty and unrelated cookies', () => {
    expect(sessionFailureReason([
      { name: 'theme', value: 'dark' },
      { name: 'sb-project-auth-token', value: '' },
    ])).toBe('no_cookie');
  });
});
```

- [ ] **Step 6: Run the session-state test and verify it fails**

Run:

```bash
cd app
npm test -- lib/auth/sessionState.test.ts
```

Expected: FAIL because `./sessionState` does not exist.

- [ ] **Step 7: Implement session-state classification and recovery copy**

Create `app/lib/auth/sessionState.ts`:

```ts
export type SessionFailureReason = 'no_cookie' | 'refresh_failed';

type NamedCookie = { name: string; value: string };

export function sessionFailureReason(cookies: readonly NamedCookie[]): SessionFailureReason {
  const hadCredential = cookies.some(
    ({ name, value }) => name.includes('auth-token') && value.length > 0,
  );
  return hadCredential ? 'refresh_failed' : 'no_cookie';
}
```

Refactor `app/lib/auth/session.ts` so its private verifier captures `store.getAll()` before `getUser()` and
returns this exact discriminated result:

```ts
export type VerifiedUserResult =
  | { user: VerifiedUser; reason: null }
  | { user: null; reason: SessionFailureReason };
```

Keep `getVerifiedUser(): Promise<VerifiedUser | null>` as a compatibility wrapper. Change
`requireVerifiedUser()` to use the result and redirect to:

```ts
`/login?next=${encodeURIComponent(nextPath)}&reason=${result.reason}`
```

Extend the login page's `searchParams` type with `reason?: SessionFailureReason`. Show copy only for
`refresh_failed`: “Your saved sign-in could not be refreshed. Please verify once more on this device.”
`no_cookie` is normal first-time behavior and gets no warning. The later identity plan adds
`unbound_identity`, `membership_revoked`, and `wedding_access_expired`; do not invent those states here.

- [ ] **Step 8: Run focused tests, typecheck, and build**

Run:

```bash
cd app
npm test -- app/login/page.test.tsx lib/auth/landing.test.ts lib/auth/sessionState.test.ts
npm run typecheck
SUPABASE_URL=https://build.invalid \
SUPABASE_ANON_KEY=build-anon-key \
SUPABASE_SERVICE_ROLE_KEY=build-service-key \
npm run build
```

Expected: all commands exit 0 and `.next/BUILD_ID` exists.

- [ ] **Step 9: Commit**

```bash
git add app/app/login/page.tsx app/app/login/page.test.tsx app/app/auth/callback/route.ts \
  app/lib/auth/session.ts app/lib/auth/sessionState.ts app/lib/auth/sessionState.test.ts
git commit -m "fix: reuse valid guest sessions"
```

---

### Task 4: Make cookie persistence explicit and regression-tested

**Files:**
- Create: `app/lib/supabase/authCookieOptions.ts`
- Create: `app/lib/supabase/authCookieOptions.test.ts`
- Modify: `app/lib/supabase/clients.ts`
- Modify: `app/lib/supabase/middleware.ts`
- Create: `app/lib/supabase/middleware.test.ts`

**Interfaces:**
- Produces: `authCookieOptions(isProduction?)` returning one shared `CookieOptions` policy.
- Preserves: `updateSession(request): Promise<NextResponse>` and its request/response rotation contract.

- [ ] **Step 1: Write failing cookie-policy tests**

Create `app/lib/supabase/authCookieOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE_MAX_AGE_SECONDS, authCookieOptions } from './authCookieOptions';

describe('authCookieOptions', () => {
  it('persists the browser credential for the browser maximum', () => {
    expect(AUTH_COOKIE_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
    expect(authCookieOptions(true)).toMatchObject({
      path: '/', sameSite: 'lax', secure: true, maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    });
  });

  it('allows local HTTP development', () => {
    expect(authCookieOptions(false).secure).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the policy test fails**

Run:

```bash
cd app
npm test -- lib/supabase/authCookieOptions.test.ts
```

Expected: FAIL because `authCookieOptions.ts` does not exist.

- [ ] **Step 3: Implement the shared policy**

Create `app/lib/supabase/authCookieOptions.ts`:

```ts
import type { CookieOptions } from '@supabase/ssr';

export const AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function authCookieOptions(isProduction = process.env.NODE_ENV === 'production'): CookieOptions {
  return {
    path: '/',
    sameSite: 'lax',
    secure: isProduction,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}
```

Do not set a custom cookie name or `domain`; host-only cookies for `sangam.vitan.in` avoid cross-subdomain
leakage. Do not set `httpOnly=true`, because the Supabase browser client may need the cookie for refresh.

- [ ] **Step 4: Apply the policy to every server client**

In `app/lib/supabase/clients.ts`, change `userClient` to:

```ts
export function userClient(cookies: CookieMethodsServer) {
  return createServerClient<Database>(URL, ANON, {
    cookies,
    cookieOptions: authCookieOptions(),
  });
}
```

Import `authCookieOptions` from `./authCookieOptions`.

In `app/lib/supabase/middleware.ts`, add the same `cookieOptions: authCookieOptions()` property next to
the existing cookie adapter. Do not move code between `createServerClient` and `getUser()`.

- [ ] **Step 5: Write the refresh-propagation regression test**

Create `app/lib/supabase/middleware.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock('@supabase/ssr', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@supabase/ssr')>();
  return { ...original, createServerClient: mocks.createServerClient };
});

describe('updateSession', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
  });

  it('calls getUser and copies a rotated cookie to request and response', async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([{ name: 'sb-auth', value: 'rotated', options: { path: '/' } }]);
          return { data: { user: { id: 'u1' } }, error: null };
        },
      },
    }));

    const { updateSession } = await import('./middleware');
    const request = new NextRequest('https://sangam.vitan.in/schedule');
    const response = await updateSession(request);

    expect(request.cookies.get('sb-auth')?.value).toBe('rotated');
    expect(response.cookies.get('sb-auth')?.value).toBe('rotated');
    expect(mocks.createServerClient.mock.calls[0][2].cookieOptions).toMatchObject({
      path: '/', sameSite: 'lax', secure: true,
    });
  });
});
```

- [ ] **Step 6: Run all app gates**

Run:

```bash
cd app
npm test
npm run typecheck
npm audit --audit-level=high
SUPABASE_URL=https://build.invalid \
SUPABASE_ANON_KEY=build-anon-key \
SUPABASE_SERVICE_ROLE_KEY=build-service-key \
npm run build
```

Expected: tests/typecheck/build pass, audit has zero high/critical findings, and `.next/BUILD_ID` exists.

- [ ] **Step 7: Commit**

```bash
git add app/lib/supabase/authCookieOptions.ts \
  app/lib/supabase/authCookieOptions.test.ts \
  app/lib/supabase/clients.ts \
  app/lib/supabase/middleware.ts \
  app/lib/supabase/middleware.test.ts
git commit -m "fix: persist and refresh trusted sessions"
```

---

### Task 5: Add a real persistent-browser certification script

**Files:**
- Create: `app/scripts/verify-session-persistence.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes env: `E2E_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `npm run verify:session`, which creates and deletes a disposable Auth user and browser profile.

- [ ] **Step 1: Create the live/staging verifier**

Create `app/scripts/verify-session-persistence.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const baseUrl = process.env.E2E_BASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
for (const [name, value] of Object.entries({ E2E_BASE_URL: baseUrl, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey })) {
  if (!value) throw new Error(`Missing ${name}`);
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const email = `session-check-${Date.now()}@example.test`;
const profile = await mkdtemp(join(tmpdir(), 'sangam-session-'));
const origin = baseUrl.replace(/\/$/, '');
let authUserId;

try {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  authUserId = data.user.id;
  const tokenHash = data.properties.hashed_token;
  assert.ok(tokenHash, 'Supabase did not return a hashed token');

  let browser = await chromium.launchPersistentContext(profile, { headless: true });
  let page = await browser.newPage();
  await page.goto(`${origin}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`, {
    waitUntil: 'networkidle',
  });
  assert.notEqual(new URL(page.url()).pathname, '/login', 'first sign-in returned to login');

  const authCookies = (await browser.cookies()).filter((cookie) => cookie.name.includes('auth-token'));
  assert.ok(authCookies.length > 0, 'no Supabase auth cookie was stored');
  assert.ok(authCookies.every((cookie) => cookie.expires > Date.now() / 1000 + 24 * 60 * 60), 'auth cookie is not persistent');
  await browser.close();

  browser = await chromium.launchPersistentContext(profile, { headless: true });
  page = await browser.newPage();
  await page.goto(`${origin}/login`, { waitUntil: 'networkidle' });
  assert.notEqual(new URL(page.url()).pathname, '/login', 'browser restart required another OTP');
  await browser.close();

  console.log('PASS: session survived browser restart and /login redirected automatically');
} finally {
  if (authUserId) {
    await admin.schema('app').from('account').delete().eq('auth_user_id', authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }
  await rm(profile, { recursive: true, force: true });
}
```

The script must print no email, token, cookie value, or key.

- [ ] **Step 2: Ignore Playwright artifacts defensively**

Append to the repository `.gitignore`:

```gitignore
app/test-results/
app/playwright-report/
app/.session-profile/
```

- [ ] **Step 3: Install Chromium and run against a non-production environment first**

Start the Next app in one terminal with a non-production Supabase project's URL/keys. In a second terminal,
run:

```bash
cd app
npx playwright install chromium
E2E_BASE_URL=http://127.0.0.1:3000 \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
npm run verify:session
```

Expected: one `PASS` line; the disposable Auth user and `app.account` row are absent afterward.

- [ ] **Step 4: Verify failure cleanup**

Temporarily run with `E2E_BASE_URL=https://example.invalid`; expect a non-zero exit. Then query the Auth
user list and `app.account` by the generated prefix and confirm the `finally` cleanup left no row. Do not
weaken cleanup assertions to make this pass.

- [ ] **Step 5: Commit**

```bash
git add app/scripts/verify-session-persistence.mjs .gitignore
git commit -m "test: certify persistent browser sessions"
```

---

### Task 6: Put the regression in CI and document the release gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `app/README.md`
- Modify: `VALIDATION.md`
- Modify: `DEPLOY.md`

**Interfaces:**
- CI consumes `npm test`; live certification remains a deliberate secret-bearing deployment command.
- Produces a documented enablement gate before Telegram work begins.

- [ ] **Step 1: Add unit tests to the app-build job**

In `.github/workflows/ci.yml`, place this step after `npm ci` and before typecheck:

```yaml
      - run: npm test
```

Do not add production Supabase credentials to GitHub Actions in this task. The persistent-browser script
is run manually against staging and production because it uses a service-role key.

- [ ] **Step 2: Update operating documentation**

Add the following facts without claiming Telegram is implemented:

- `app/README.md`: a valid session bypasses `/login`; cookie refresh is silent; email is first-time or
  recovery authentication.
- `VALIDATION.md`: unit tests protect safe redirects and request/response cookie rotation; list the exact
  date/domain of each successful `verify:session` run.
- `DEPLOY.md`: after deploying, run `npm run verify:session` with secrets supplied from the operator shell,
  never committed or pasted into logs; failure blocks Telegram work and real-guest rollout.

- [ ] **Step 3: Run every local release gate**

Run from the repository root:

```bash
DATABASE_URL="postgresql:///sangam_session_plan_check" bash scripts/run-sql-suites.sh
cd app
npm ci
npm test
npm run typecheck
npm audit --audit-level=high
SUPABASE_URL=https://build.invalid \
SUPABASE_ANON_KEY=build-anon-key \
SUPABASE_SERVICE_ROLE_KEY=build-service-key \
npm run build
test -s .next/BUILD_ID
```

Create/drop the temporary database around the SQL command using the repository's established validation
workflow. Expected: all 16 SQL suites, unit tests, typecheck, audit, and build pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml app/README.md VALIDATION.md DEPLOY.md
git commit -m "docs: gate persistent session rollout"
```

---

### Task 7: Deploy and certify `sangam.vitan.in`

**Files:**
- Modify only if certification evidence changes: `VALIDATION.md`

**Interfaces:**
- Consumes: green GitHub CI, Coolify deployment, production Supabase service-role secret in the local
  operator environment.
- Produces: a go/no-go result for beginning the Telegram identity plan.

- [ ] **Step 1: Push only after reviewing the complete diff**

Run:

```bash
git status -sb
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git push origin main
```

Expected: push succeeds and the working tree remains clean.

- [ ] **Step 2: Wait for GitHub CI and Coolify**

Run:

```bash
gh run list --branch main --limit 1
gh run watch "$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
curl -fsS -o /dev/null -w '%{http_code}\n' https://sangam.vitan.in
```

Expected: both CI jobs pass and the site returns HTTP 200.

- [ ] **Step 3: Run the production persistent-browser certification**

From `app/`, with secrets loaded without shell echo/history leakage:

```bash
E2E_BASE_URL=https://sangam.vitan.in \
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
npm run verify:session
```

Expected: `PASS: session survived browser restart and /login redirected automatically`.

- [ ] **Step 4: Perform one senior-guest manual check**

On an actual phone browser:

1. sign in once through email;
2. close the browser completely;
3. reopen `https://sangam.vitan.in/login`;
4. confirm it opens the schedule/authorized console without an email or code;
5. sign out and confirm `/schedule` then returns to login.

Record only browser/OS, timestamp, pass/fail, and failure reason. Do not record the guest's contact.

- [ ] **Step 5: Record certification evidence and commit**

Add the production run date, domain, browser family, CI URL, and pass/fail to `VALIDATION.md`, then run:

```bash
git add VALIDATION.md
git commit -m "docs: certify production session persistence"
git push origin main
```

The gate is open for the separate Telegram identity implementation plan only when CI, automated
persistent-browser certification, and the manual phone check all pass.
