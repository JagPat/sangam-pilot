// Invite redemption — the TOKEN is the sole authority for which wedding/guest this is (the client never
// supplies a wedding id, so there is nothing to mismatch after the fact). The account comes from a
// VERIFIED server-side session (see lib/auth/session.ts), never from the URL.
//
// app.redeem_and_bind does everything atomically while the token row is locked: validate, mark used,
// bind to this account (reject conflict), and return the wedding + guest derived from the token.

import { serviceCommand } from '../supabase/clients';

// READ-ONLY validity check — NO PII. Safe for the UNAUTHENTICATED preview (link scanners, unfurl/preview
// bots, forwarded-link recipients): returns only whether the link is live and, for theming, the wedding
// id. Never consumes the link, never returns the guest's name.
export async function peekInvite(rawToken: string): Promise<{ weddingId: string | null; valid: boolean }> {
  return serviceCommand('invite_exchange', null, async (db) => {
    const { data, error } = await db.schema('app').rpc('peek_access_link', { p_raw: rawToken });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { weddingId: null, valid: false };
    return { weddingId: row.wedding_id ?? null, valid: !!row.valid };
  });
}

// READ-ONLY, RETURNS the guest name for the confirmation UI. The name is PII — call ONLY once a verified
// session exists (page.tsx uses this exclusively in the signed-in branch). Also RECIPIENT-BOUND: pass the
// session's verified contact; the DB returns the name only when it matches the invited contact, so a
// forwarded link opened by another authenticated account sees nothing. Never consumes the link.
export async function peekInviteDetails(
  rawToken: string,
  verifiedContact: string,
): Promise<{ weddingId: string; guestId: string; guestName: string | null } | null> {
  return serviceCommand('invite_exchange', null, async (db) => {
    const { data, error } = await db
      .schema('app')
      .rpc('peek_invite_details', { p_raw: rawToken, p_verified_contact: verifiedContact });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.valid || !row.wedding_id || !row.guest_id) return null;
    return { weddingId: row.wedding_id, guestId: row.guest_id, guestName: row.guest_name };
  });
}

// RECIPIENT-BOUND redemption: the verified session contact must match the invited contact, so a valid
// session for some OTHER account holding a forwarded link cannot redeem. The account still comes from the
// verified session; the token is still the sole wedding/guest authority.
export async function redeemInvite(
  rawToken: string,
  authUserId: string,
  verifiedContact: string,
): Promise<{ weddingId: string; guestId: string }> {
  return serviceCommand('invite_exchange', null, async (db) => {
    const { data: acct, error: e1 } = await db
      .schema('app')
      .from('account')
      .upsert({ auth_user_id: authUserId }, { onConflict: 'auth_user_id' })
      .select('id')
      .single();
    if (e1) throw e1;

    const { data, error } = await db
      .schema('app')
      .rpc('redeem_and_bind', { p_raw: rawToken, p_account: acct.id, p_verified_contact: verifiedContact });
    if (error) throw error; // 'invalid link' | 'link already used' | 'link expired' | 'verified contact...' | conflict
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('invalid or already-used link');
    return { weddingId: row.wedding_id, guestId: row.guest_id };
  });
}
