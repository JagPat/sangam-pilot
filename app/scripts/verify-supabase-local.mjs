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

  console.log('SUPABASE REAL-AUTH GATE PASSED');
} finally {
  if (weddingId) await admin.schema('app').from('wedding').delete().eq('id', weddingId);
  if (authUserId) {
    await admin.schema('app').from('account').delete().eq('auth_user_id', authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }
  if (approverAuthUserId) {
    await admin.schema('app').from('account').delete().eq('auth_user_id', approverAuthUserId);
    await admin.auth.admin.deleteUser(approverAuthUserId);
  }
}
