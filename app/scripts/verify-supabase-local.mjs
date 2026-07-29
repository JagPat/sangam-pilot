import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { spawn } from 'node:child_process';

const url = process.env.SUPABASE_URL || process.env.API_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Supabase local URL/anon/service keys are required');

const email = `sangam-gate-${crypto.randomUUID()}@example.test`;
const password = `Gate-${crypto.randomUUID()}-aA1!`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let authUserId;
let approverAuthUserId;
let intendedAuthUserId;
let wrongContactAuthUserId;
let weddingId;
let appServer;

async function sessionCookieHeader(session) {
  let cookies = [];
  const browser = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (nextCookies) => { cookies = nextCookies; },
    },
  });
  const { error } = await browser.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error || cookies.length === 0) throw error ?? new Error('real GoTrue session cookie was not created');
  return cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

async function startVerifierApp() {
  const port = 34000 + Math.floor(Math.random() * 1000);
  appServer = spawn('npm', ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INVITE_EXCHANGE_ENABLED: '1',
      SANGAM_REAL_AUTH_TEST: '1',
      NODE_ENV: 'development',
    },
    // Next dev normally logs every requested path, which would include the raw one-time token. The gate
    // intentionally discards child output and reports only its own non-sensitive pass/fail messages.
    stdio: 'ignore',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return baseUrl;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('local verifier app did not start');
}

async function stopVerifierApp() {
  if (!appServer || appServer.exitCode !== null) return;
  appServer.kill('SIGTERM');
  await new Promise((resolve) => appServer.once('exit', resolve));
}

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('auth user not created');
  authUserId = created.data.user.id;

  const account = await admin.schema('app').from('account').insert({
    auth_user_id: authUserId, email, can_create_wedding: true,
  }).select('id').single();
  if (account.error) throw account.error;

  const browser = createClient(url, anonKey, { auth: { persistSession: false } });
  const signedIn = await browser.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('real GoTrue session missing');

  const capabilityEscalation = await browser.schema('app').from('account')
    .update({ can_create_wedding: false }).eq('auth_user_id', authUserId);
  if (!capabilityEscalation.error) throw new Error('authenticated account holder changed protected creator capability');
  const preferenceUpdate = await browser.schema('app').from('account')
    .update({ preferred_language: 'gu' }).eq('auth_user_id', authUserId);
  if (preferenceUpdate.error) throw preferenceUpdate.error;

  const made = await browser.schema('app').rpc('create_wedding', {
    p_title: 'Supabase integration gate', p_couple: null, p_tz: 'Asia/Kolkata', p_start: null, p_end: null,
  });
  if (made.error || !made.data) throw made.error ?? new Error('authenticated owner command failed');
  weddingId = made.data;

  // The creator is provisioned atomically as owner + event manager. Exercise the new official-cost
  // workflow through real GoTrue JWTs and PostgREST, not a hand-built auth stub.
  const initialized = await browser.schema('app').rpc('initialize_cost_control', { p_wedding: weddingId });
  if (initialized.error) throw initialized.error;
  const centre = await browser.schema('app').from('cost_centre').select('id').eq('wedding_id', weddingId).limit(1).single();
  if (centre.error) throw centre.error;
  const item = await browser.schema('app').rpc('create_cost_item', {
    p_wedding: weddingId, p_centre: centre.data.id, p_title: 'Real-auth venue target', p_description: null,
    p_event: null, p_engagement: null, p_decision_due: null,
  });
  if (item.error || !item.data) throw item.error ?? new Error('event manager could not create cost item');
  const estimate = await browser.schema('app').rpc('save_cost_estimate_draft', {
    p_wedding: weddingId, p_item: item.data, p_estimate: null,
    p_input: { subtotal: 100000, tax_rate: 18, currency_code: 'INR' },
  });
  if (estimate.error || !estimate.data) throw estimate.error ?? new Error('event manager could not draft estimate');
  const submitted = await browser.schema('app').rpc('submit_cost_estimate', { p_wedding: weddingId, p_estimate: estimate.data });
  if (submitted.error) throw submitted.error;

  const approverEmail = `sangam-approver-${crypto.randomUUID()}@example.test`;
  const approverPassword = `Gate-${crypto.randomUUID()}-aA1!`;
  const approverCreated = await admin.auth.admin.createUser({ email: approverEmail, password: approverPassword, email_confirm: true });
  if (approverCreated.error || !approverCreated.data.user) throw approverCreated.error ?? new Error('approver auth user not created');
  approverAuthUserId = approverCreated.data.user.id;
  const approverAccount = await admin.schema('app').from('account').insert({ auth_user_id: approverAuthUserId, email: approverEmail }).select('id').single();
  if (approverAccount.error) throw approverAccount.error;
  const member = await admin.schema('app').from('wedding_membership').insert({ wedding_id: weddingId, account_id: approverAccount.data.id, status: 'active' });
  if (member.error) throw member.error;
  const role = await admin.schema('app').from('operator_role').insert({ wedding_id: weddingId, account_id: approverAccount.data.id, role: 'cost_approver', host_group_id: null });
  if (role.error) throw role.error;
  const approver = createClient(url, anonKey, { auth: { persistSession: false } });
  const approverSignedIn = await approver.auth.signInWithPassword({ email: approverEmail, password: approverPassword });
  if (approverSignedIn.error) throw approverSignedIn.error;
  const reviewed = await approver.schema('app').rpc('begin_cost_review', { p_wedding: weddingId, p_estimate: estimate.data });
  if (reviewed.error) throw reviewed.error;
  const decided = await approver.schema('app').rpc('decide_cost_estimate', {
    p_wedding: weddingId, p_estimate: estimate.data, p_decision: 'approved',
    p_reason: 'Real-auth approval gate', p_expected_state: 'under_review',
  });
  if (decided.error) throw decided.error;
  const privateRead = await browser.schema('app').from('finance_expense').select('id').limit(1);
  if (!privateRead.error) throw new Error('retired private finance remained readable through PostgREST');

  const ownerRead = await browser.schema('app').from('wedding').select('id').eq('id', weddingId).single();
  if (ownerRead.error || ownerRead.data.id !== weddingId) throw ownerRead.error ?? new Error('owner RLS read failed');

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const anonRead = await anon.schema('app').from('wedding').select('id').eq('id', weddingId);
  if (!anonRead.error && (anonRead.data?.length ?? 0) !== 0) throw new Error('anon read wedding through RLS');

  const forbidden = await browser.schema('app').rpc('link_signed_in_account', { p_auth_user_id: authUserId });
  if (!forbidden.error) throw new Error('authenticated caller executed service-role-only linker');

  // Recipient-bound invite exchange. The issuing owner, intended recipient, and wrong-contact recipient
  // all use real GoTrue sessions. Raw links stay in this process only: never print or persist them.
  const intendedEmail = `sangam-invite-${crypto.randomUUID()}@example.test`;
  const intendedPassword = `Gate-${crypto.randomUUID()}-aA1!`;
  const wrongContactEmail = `sangam-wrong-contact-${crypto.randomUUID()}@example.test`;
  const wrongContactPassword = `Gate-${crypto.randomUUID()}-aA1!`;
  const intendedCreated = await admin.auth.admin.createUser({
    email: intendedEmail, password: intendedPassword, email_confirm: true,
  });
  if (intendedCreated.error || !intendedCreated.data.user) {
    throw intendedCreated.error ?? new Error('intended invite auth user not created');
  }
  intendedAuthUserId = intendedCreated.data.user.id;
  const wrongContactCreated = await admin.auth.admin.createUser({
    email: wrongContactEmail, password: wrongContactPassword, email_confirm: true,
  });
  if (wrongContactCreated.error || !wrongContactCreated.data.user) {
    throw wrongContactCreated.error ?? new Error('wrong-contact auth user not created');
  }
  wrongContactAuthUserId = wrongContactCreated.data.user.id;

  const household = await admin.schema('app').from('household')
    .insert({ wedding_id: weddingId, name: 'Invite gate household' }).select('id').single();
  if (household.error || !household.data) throw household.error ?? new Error('invite gate household not created');
  const guest = await admin.schema('app').from('guest').insert({
    wedding_id: weddingId, household_id: household.data.id, full_name: 'Invite gate guest',
  }).select('id').single();
  if (guest.error || !guest.data) throw guest.error ?? new Error('invite gate guest not created');
  const guestId = guest.data.id;
  const contact = await admin.schema('app').from('household_contact').insert({
    wedding_id: weddingId, household_id: household.data.id, guest_id: guestId,
    channel: 'email', value: intendedEmail, is_shared: false,
  });
  if (contact.error) throw contact.error;

  // The issuing wrapper is called through the owner's real JWT. It reads the stored contact itself; the
  // returned raw token is intentionally retained only in this local variable while the database stores hashes.
  const issued = await browser.schema('app').rpc('issue_guest_access_link', {
    p_wedding: weddingId, p_guest: guestId, p_ttl: '30 days',
  });
  if (issued.error || !issued.data) throw issued.error ?? new Error('owner could not issue recipient-bound invite');
  const rawInvite = issued.data;
  const verifierBaseUrl = await startVerifierApp();
  const inviteUrl = `${verifierBaseUrl}/invite/${encodeURIComponent(rawInvite)}`;
  const redeemUrl = `${verifierBaseUrl}/api/test/invite-redeem/${encodeURIComponent(rawInvite)}`;

  // Exercise the actual GET page without cookies. It must be valid/no-PII and remain valid after a repeat.
  const signedOutPreview = await fetch(inviteUrl, { redirect: 'manual' });
  const signedOutHtml = await signedOutPreview.text();
  if (!signedOutPreview.ok || !signedOutHtml.includes('Sign in to continue')) {
    throw new Error('signed-out invite page did not show its non-consuming sign-in CTA');
  }
  if (signedOutHtml.includes('Invite gate guest') || signedOutHtml.includes(intendedEmail)) {
    throw new Error('signed-out invite page disclosed PII');
  }
  const signedOutPreviewRepeat = await fetch(inviteUrl, { redirect: 'manual' });
  if (!signedOutPreviewRepeat.ok || !(await signedOutPreviewRepeat.text()).includes('Sign in to continue')) {
    throw new Error('signed-out invite page consumed the link');
  }

  const intendedBrowser = createClient(url, anonKey, { auth: { persistSession: false } });
  const intendedSignedIn = await intendedBrowser.auth.signInWithPassword({ email: intendedEmail, password: intendedPassword });
  if (intendedSignedIn.error || !intendedSignedIn.data.session) {
    throw intendedSignedIn.error ?? new Error('intended recipient real GoTrue session missing');
  }
  const intendedUser = await intendedBrowser.auth.getUser();
  if (intendedUser.error || !intendedUser.data.user?.email_confirmed_at || intendedUser.data.user.email !== intendedEmail) {
    throw intendedUser.error ?? new Error('intended recipient was not verified by GoTrue');
  }
  const intendedCookie = await sessionCookieHeader(intendedSignedIn.data.session);

  const wrongContactBrowser = createClient(url, anonKey, { auth: { persistSession: false } });
  const wrongContactSignedIn = await wrongContactBrowser.auth.signInWithPassword({
    email: wrongContactEmail, password: wrongContactPassword,
  });
  if (wrongContactSignedIn.error || !wrongContactSignedIn.data.session) {
    throw wrongContactSignedIn.error ?? new Error('wrong-contact real GoTrue session missing');
  }
  const wrongContactUser = await wrongContactBrowser.auth.getUser();
  if (wrongContactUser.error || !wrongContactUser.data.user?.email_confirmed_at || wrongContactUser.data.user.email !== wrongContactEmail) {
    throw wrongContactUser.error ?? new Error('wrong-contact user was not verified by GoTrue');
  }
  const wrongContactCookie = await sessionCookieHeader(wrongContactSignedIn.data.session);
  const wrongPreview = await fetch(inviteUrl, { headers: { cookie: wrongContactCookie }, redirect: 'manual' });
  const wrongPreviewHtml = await wrongPreview.text();
  if (!wrongPreview.ok || !wrongPreviewHtml.includes('different contact') || wrongPreviewHtml.includes('Invite gate guest')) {
    throw new Error('wrong-contact invite page disclosed invitation details');
  }
  const wrongRedeem = await fetch(redeemUrl, { method: 'POST', headers: { cookie: wrongContactCookie } });
  if (wrongRedeem.status !== 403) throw new Error('wrong-contact recipient redeemed an invite');
  const stillValid = await fetch(inviteUrl, { redirect: 'manual' });
  if (!stillValid.ok || !(await stillValid.text()).includes('Sign in to continue')) {
    throw new Error('wrong-contact redemption consumed the invite');
  }

  const intendedRedeem = await fetch(redeemUrl, { method: 'POST', headers: { cookie: intendedCookie } });
  if (!intendedRedeem.ok || !(await intendedRedeem.json()).ok) throw new Error('intended recipient could not redeem invite');
  const boundGuest = await admin.schema('app').from('guest').select('self_account_id').eq('id', guestId).single();
  if (boundGuest.error || !boundGuest.data?.self_account_id) {
    throw boundGuest.error ?? new Error('intended recipient was not bound by the production redemption path');
  }
  const intendedReplay = await fetch(redeemUrl, { method: 'POST', headers: { cookie: intendedCookie } });
  if (!intendedReplay.ok || !(await intendedReplay.json()).ok) {
    throw new Error('intended recipient replay was not idempotent');
  }

  // The real wrong-contact session above is denied before the database reaches the used-link branch.
  // Reuse that session's linked account with the intended contact to make the cross-account replay
  // assertion reason-specific: the RPC must now reject it because another account already used the link.
  const wrongAccount = await admin
    .schema('app')
    .from('account')
    .select('id')
    .eq('auth_user_id', wrongContactAuthUserId)
    .single();
  if (wrongAccount.error || !wrongAccount.data) {
    throw wrongAccount.error ?? new Error('wrong-contact session was not linked to an app account');
  }
  const crossAccountReplay = await admin.schema('app').rpc('redeem_and_bind', {
    p_raw: rawInvite,
    p_account: wrongAccount.data.id,
    p_verified_contact: intendedEmail,
  });
  if (!crossAccountReplay.error || !/link already used/i.test(crossAccountReplay.error.message ?? '')) {
    throw new Error('used invite did not reject a different account specifically');
  }
  const consumed = await fetch(inviteUrl, { redirect: 'manual' });
  if (!consumed.ok || !(await consumed.text()).includes('invalid or has already been used')) {
    throw new Error('redeemed invite remained valid');
  }

  console.log('SUPABASE REAL-AUTH GATE PASSED');
} finally {
  await stopVerifierApp();
  const cleanupFailures = [];
  const clean = async (operation) => {
    try {
      const result = await operation();
      if (result?.error) throw result.error;
    } catch {
      cleanupFailures.push(true);
    }
  };
  if (weddingId) await clean(() => admin.schema('app').from('wedding').delete().eq('id', weddingId));
  if (authUserId) {
    await clean(() => admin.schema('app').from('account').delete().eq('auth_user_id', authUserId));
    await clean(() => admin.auth.admin.deleteUser(authUserId));
  }
  if (approverAuthUserId) {
    await clean(() => admin.schema('app').from('account').delete().eq('auth_user_id', approverAuthUserId));
    await clean(() => admin.auth.admin.deleteUser(approverAuthUserId));
  }
  if (intendedAuthUserId) {
    await clean(() => admin.schema('app').from('account').delete().eq('auth_user_id', intendedAuthUserId));
    await clean(() => admin.auth.admin.deleteUser(intendedAuthUserId));
  }
  if (wrongContactAuthUserId) {
    await clean(() => admin.schema('app').from('account').delete().eq('auth_user_id', wrongContactAuthUserId));
    await clean(() => admin.auth.admin.deleteUser(wrongContactAuthUserId));
  }
  if (cleanupFailures.length) throw new Error('Supabase real-auth gate cleanup failed');
}
