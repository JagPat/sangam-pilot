import { serviceCommand } from '../supabase/clients';

// After a verified sign-in, ensure this auth user has an app.account and is bound to any guest whose
// PERSONAL email contact matches their VERIFIED email (app.link_signed_in_account — SECURITY DEFINER,
// service-only). This is what lets an organizer add a guest by email and have them "just work" on their
// first sign-in, with no manual SQL binding step.
//
// A linking failure does not invalidate the Supabase session, but it must be surfaced as a retryable
// application-account setup failure. The auth user id must be
// the VALIDATED id from getUser()/verifyOtp — never a value taken from the URL or a form.
export type AccountLinkResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: 'account_link_failed' };

type AccountLinkCommand = (authUserId: string) => Promise<string>;

async function linkAccountThroughService(authUserId: string): Promise<string> {
  return serviceCommand('account_link', null, async (db) => {
    const { data, error } = await db.schema('app').rpc('link_signed_in_account', { p_auth_user_id: authUserId });
    if (error) throw error;
    if (!data) throw new Error('account linker returned no account id');
    return data as string;
  });
}

export async function linkSignedInAccountWith(
  authUserId: string,
  command: AccountLinkCommand,
): Promise<AccountLinkResult> {
  try {
    const accountId = await command(authUserId);
    return { ok: true, accountId };
  } catch (e) {
    console.error('[sangam] account self-link failed:', e);
    return { ok: false, reason: 'account_link_failed' };
  }
}

export async function linkSignedInAccount(authUserId: string): Promise<AccountLinkResult> {
  return linkSignedInAccountWith(authUserId, linkAccountThroughService);
}
