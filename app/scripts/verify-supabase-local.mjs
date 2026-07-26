import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.API_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Supabase local URL/anon/service keys are required');

const email = `sangam-gate-${crypto.randomUUID()}@example.test`;
const password = `Gate-${crypto.randomUUID()}-aA1!`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let authUserId;
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

  const made = await browser.schema('app').rpc('create_wedding', {
    p_title: 'Supabase integration gate', p_couple: null, p_tz: 'Asia/Kolkata', p_start: null, p_end: null,
  });
  if (made.error || !made.data) throw made.error ?? new Error('authenticated owner command failed');
  weddingId = made.data;

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
}
