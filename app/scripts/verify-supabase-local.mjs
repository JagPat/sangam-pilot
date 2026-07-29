import { createClient } from '@supabase/supabase-js';

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

  // The issuing RPC is called through the owner's real JWT. The returned raw token is intentionally
  // retained only in this local variable, while the database stores its hash.
  const issued = await browser.schema('app').rpc('issue_access_link', {
    p_wedding: weddingId, p_guest: guestId, p_contact: intendedEmail, p_ttl: '30 days',
  });
  if (issued.error || !issued.data) throw issued.error ?? new Error('owner could not issue recipient-bound invite');
  const rawInvite = issued.data;

  // This mirrors the signed-out GET's service-side no-PII preview: it is non-consuming and returns only
  // validity/wedding context, never a guest name. Calling it twice proves a scanner/prefetch cannot burn it.
  const signedOutPreview = await admin.schema('app').rpc('peek_access_link', { p_raw: rawInvite });
  if (signedOutPreview.error || !Array.isArray(signedOutPreview.data) || !signedOutPreview.data[0]?.valid) {
    throw signedOutPreview.error ?? new Error('signed-out invite preview was not valid');
  }
  if (Object.hasOwn(signedOutPreview.data[0], 'guest_name')) throw new Error('signed-out invite preview disclosed PII');
  const signedOutPreviewRepeat = await admin.schema('app').rpc('peek_access_link', { p_raw: rawInvite });
  if (signedOutPreviewRepeat.error || !signedOutPreviewRepeat.data?.[0]?.valid) {
    throw signedOutPreviewRepeat.error ?? new Error('signed-out invite preview consumed the link');
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
  const intendedAccount = await admin.schema('app').from('account')
    .insert({ auth_user_id: intendedAuthUserId, email: intendedEmail }).select('id').single();
  if (intendedAccount.error || !intendedAccount.data) throw intendedAccount.error ?? new Error('intended account not created');

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
  const wrongContactAccount = await admin.schema('app').from('account')
    .insert({ auth_user_id: wrongContactAuthUserId, email: wrongContactEmail }).select('id').single();
  if (wrongContactAccount.error || !wrongContactAccount.data) {
    throw wrongContactAccount.error ?? new Error('wrong-contact account not created');
  }

  const wrongPreview = await admin.schema('app').rpc('peek_invite_details', {
    p_raw: rawInvite, p_verified_contact: wrongContactUser.data.user.email,
  });
  if (wrongPreview.error || !Array.isArray(wrongPreview.data) || wrongPreview.data[0]?.valid || wrongPreview.data[0]?.guest_name) {
    throw wrongPreview.error ?? new Error('wrong-contact preview disclosed invitation details');
  }
  const wrongRedeem = await admin.schema('app').rpc('redeem_and_bind', {
    p_raw: rawInvite, p_account: wrongContactAccount.data.id, p_verified_contact: wrongContactUser.data.user.email,
  });
  if (!wrongRedeem.error) throw new Error('wrong-contact recipient redeemed an invite');
  const stillValid = await admin.schema('app').rpc('peek_access_link', { p_raw: rawInvite });
  if (stillValid.error || !stillValid.data?.[0]?.valid) {
    throw stillValid.error ?? new Error('wrong-contact redemption consumed the invite');
  }

  const intendedRedeem = await admin.schema('app').rpc('redeem_and_bind', {
    p_raw: rawInvite, p_account: intendedAccount.data.id, p_verified_contact: intendedUser.data.user.email,
  });
  if (intendedRedeem.error || !Array.isArray(intendedRedeem.data) || intendedRedeem.data[0]?.guest_id !== guestId) {
    throw intendedRedeem.error ?? new Error('intended recipient could not redeem invite');
  }
  const replay = await admin.schema('app').rpc('redeem_and_bind', {
    p_raw: rawInvite, p_account: wrongContactAccount.data.id, p_verified_contact: intendedUser.data.user.email,
  });
  if (!replay.error) throw new Error('used invite was redeemed by another account');
  const consumed = await admin.schema('app').rpc('peek_access_link', { p_raw: rawInvite });
  if (consumed.error || consumed.data?.[0]?.valid) throw consumed.error ?? new Error('redeemed invite remained valid');

  console.log('SUPABASE REAL-AUTH GATE PASSED');
} finally {
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
