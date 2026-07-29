'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';
import { linkSignedInAccount } from '@/lib/auth/link';
import { getOrganizerNav } from '@/lib/data/nav';
import { getCreatorAccess } from '@/lib/data/creator-access';
import { postAuthDestination, safeInternalPath, withSafeNext } from '@/lib/auth/landing';
import type { AppSupabaseClient } from '@/lib/supabase/clients';

// Sends a code-only Supabase email OTP. The hosted template intentionally has no confirmation URL because
// mail security scanners can pre-open a one-time link and consume the same token before the guest uses it.
export async function sendSignInCode(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const next = String(formData.get('next') ?? '');
  const safeNext = next ? safeInternalPath(next, '/schedule') : null;
  if (!email) redirect(withSafeNext('/login?error=email', next));

  const h = await headers();
  const origin = h.get('origin') ?? `https://${h.get('host') ?? ''}`;

  const supabase = await serverClientRW();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}` },
  });
  if (error) redirect(withSafeNext('/login?error=send', next));
  redirect(withSafeNext(`/login?sent=1&email=${encodeURIComponent(email)}`, next));
}

// Verify a typed email code (verifyOtp type=email). Unlike the emailed LINK, a typed code cannot be
// consumed by link-preview/scanner prefetch and does not depend on a PKCE verifier cookie, so it works in
// ANY browser — including the in-app browsers email apps open links in. This is the robust path for guests
// on phones. `next` is validated as a same-origin path (open-redirect guard).
export async function verifyCode(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '');
  const next = String(formData.get('next') ?? '');
  const safeNext = next ? safeInternalPath(next, '/schedule') : null;
  const backToCode = (): never =>
    redirect(withSafeNext(`/login?error=code&email=${encodeURIComponent(email)}`, next));

  if (!email || !/^[0-9]{6}$/.test(code)) backToCode();

  const supabase = await serverClientRW();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) backToCode();
  const verifiedUser = data.user;
  if (!verifiedUser) return backToCode();
  const linkResult = await linkSignedInAccount(verifiedUser.id);
  if (!linkResult.ok) redirect(withSafeNext('/access?reason=account_link_failed', safeNext));

  const appDb = supabase as unknown as AppSupabaseClient;
  const [nav, creator] = await Promise.all([getOrganizerNav(appDb), getCreatorAccess(appDb)]);
  redirect(postAuthDestination(safeNext, nav.sections, creator.canCreateWedding));
}
