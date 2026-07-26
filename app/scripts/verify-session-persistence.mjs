import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const baseUrl = process.env.E2E_BASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [name, value] of Object.entries({
  E2E_BASE_URL: baseUrl,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
})) {
  if (!value) throw new Error(`Missing ${name}`);
}

const origin = baseUrl.replace(/\/$/, '');
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const email = `session-check-${Date.now()}@example.test`;
const profile = await mkdtemp(join(tmpdir(), 'sangam-session-'));
let authUserId;

async function failIfError(result, operation) {
  if (result.error) {
    const code = result.error.code ?? result.error.status ?? 'unknown';
    throw new Error(`${operation} failed (${code})`);
  }
  return result.data;
}

try {
  const data = await failIfError(
    await admin.auth.admin.generateLink({ type: 'magiclink', email }),
    'create disposable login',
  );
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
  assert.ok(
    authCookies.every((cookie) => cookie.expires > Date.now() / 1000 + 24 * 60 * 60),
    'auth cookie is not persistent',
  );
  await browser.close();

  browser = await chromium.launchPersistentContext(profile, { headless: true });
  page = await browser.newPage();
  await page.goto(`${origin}/login`, { waitUntil: 'networkidle' });
  assert.notEqual(new URL(page.url()).pathname, '/login', 'browser restart required another OTP');
  await browser.close();

  console.log('PASS: session survived browser restart and /login redirected automatically');
} finally {
  if (authUserId) {
    await failIfError(
      await admin.schema('app').from('account').delete().eq('auth_user_id', authUserId),
      'delete disposable app account',
    );
    await failIfError(await admin.auth.admin.deleteUser(authUserId), 'delete disposable Auth user');
  }
  await rm(profile, { recursive: true, force: true });
}
