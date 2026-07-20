import { serviceCommand } from '../supabase/clients';

// After a verified sign-in, ensure this auth user has an app.account and is bound to any guest whose
// PERSONAL email contact matches their VERIFIED email (app.link_signed_in_account — SECURITY DEFINER,
// service-only). This is what lets an organizer add a guest by email and have them "just work" on their
// first sign-in, with no manual SQL binding step.
//
// Best-effort by design: a linking failure must NEVER block the sign-in itself. Worst case the guest lands
// on an empty schedule and the next sign-in retries (the function is idempotent). The auth user id must be
// the VALIDATED id from getUser()/verifyOtp — never a value taken from the URL or a form.
export async function linkSignedInAccount(authUserId: string): Promise<void> {
  try {
    await serviceCommand('account_link', null, async (db) => {
      const { error } = await db.schema('app').rpc('link_signed_in_account', { p_auth_user_id: authUserId });
      if (error) throw error;
    });
  } catch (e) {
    console.error('[sangam] account self-link failed:', e);
  }
}
