// Two clients, matching docs/CONNECTION_MODEL.md.
//   - userClient(): DEFAULT. Runs with the user's session (ANON key), so RLS applies. Never use the
//     service key in the browser.
//   - serviceCommand(): the ONLY sanctioned service-role entry point. Server-only, explicit wedding
//     context + named purpose. Use it exclusively for imports, webhooks, and scheduled jobs.

import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server env only

// Pass the Next.js cookie adapter (getAll/setAll) from your route/layout. Return type is inferred from
// createServerClient (the @supabase/ssr SupabaseClient generic differs slightly from supabase-js').
export function userClient(cookies: CookieMethodsServer) {
  return createServerClient<Database>(URL, ANON, { cookies });
}

// Command/data-layer signature type. @supabase/ssr's createServerClient return doesn't carry supabase-js'
// rpc/query arg typing, so we standardize on SupabaseClient<Database> and cast the ssr client to it at one
// boundary (pageClient). Same runtime object; this only reconciles the two packages' generic shapes.
export type AppSupabaseClient = SupabaseClient<Database>;

// 'invite_exchange' and 'account_link' are the two paths where the wedding is NOT known up front — the
// invite TOKEN (redeem_and_bind) or the signed-in email (link_signed_in_account, which may match guests in
// several weddings) is the scoping authority. Every other purpose must pass an explicit wedding context.
type ServicePurpose = 'guest_import' | 'whatsapp_webhook' | 'scheduled_job' | 'invite_exchange' | 'account_link';

// Narrow, named service-role command. Server-only. The raw client is never exported.
export async function serviceCommand<T>(
  purpose: ServicePurpose,
  weddingId: string | null,
  fn: (db: SupabaseClient<Database>, ctx: { weddingId: string | null; purpose: ServicePurpose }) => Promise<T>,
): Promise<T> {
  if (typeof window !== 'undefined') throw new Error('serviceCommand must run server-side only');
  if (!weddingId && purpose !== 'invite_exchange' && purpose !== 'account_link') {
    throw new Error('serviceCommand requires an explicit weddingId context');
  }
  const db = createClient<Database>(URL, SERVICE, { auth: { persistSession: false } });
  return fn(db, { weddingId, purpose });
}
