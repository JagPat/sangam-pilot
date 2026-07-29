'use server';

// Invite exchange — STEP 2 (POST, consuming). This is the ONLY place a link is redeemed/bound.
//
// Server actions are CSRF/origin-protected by Next (the framework rejects cross-origin POSTs). The
// account is read from the VERIFIED server session at POST time — never from the form or the URL — and
// the token is the sole wedding/guest authority (app.redeem_and_bind derives them atomically while the
// token row is locked, and rejects a used link or an account conflict).

import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth/session';
import { redeemInviteForVerifiedUser } from '@/lib/auth/inviteRedemption';

export async function confirmInvite(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!token) throw new Error('missing invite token');

  const user = await getVerifiedUser();
  if (!user?.emailConfirmed || !user.email) {
    // No verified session — bounce back to the confirmation page (which shows the sign-in prompt).
    // Nothing is consumed.
    redirect(`/invite/${encodeURIComponent(token)}`);
  }

  try {
    // Account comes from the verified session; the verified CONTACT (email/phone) must match the invited
    // recipient — the DB rejects a session for a different account holding a forwarded link. redeemInvite
    // is atomic, so a failure here (mismatch / lost race / already used) means nothing changed.
    await redeemInviteForVerifiedUser(token, user);
  } catch {
    redirect(`/invite/${encodeURIComponent(token)}?error=redeem`);
  }

  redirect('/schedule');
}
