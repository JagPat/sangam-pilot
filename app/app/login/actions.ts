'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Sends a Supabase email magic-link / OTP. Clicking it lands on /auth/callback, which establishes the
// session. Email is normalized (lower/trim) to match the recipient-binding hash used by the invite flow.
export async function sendMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const next = String(formData.get('next') ?? '/schedule');
  if (!email) redirect('/login?error=email');

  const h = await headers();
  const origin = h.get('origin') ?? `https://${h.get('host') ?? ''}`;

  const supabase = await serverClientRW();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) redirect('/login?error=send');
  redirect(`/login?sent=1&email=${encodeURIComponent(email)}`);
}

// Verify a typed email code (verifyOtp type=email). Unlike the emailed LINK, a typed code cannot be
// consumed by link-preview/scanner prefetch and does not depend on a PKCE verifier cookie, so it works in
// ANY browser — including the in-app browsers email apps open links in. This is the robust path for guests
// on phones. `next` is validated as a same-origin path (open-redirect guard).
export async function verifyCode(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '');
  const nextRaw = String(formData.get('next') ?? '/schedule');
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/schedule';
  const backToCode = () =>
    redirect(`/login?error=code&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);

  if (!email || !code) backToCode();

  const supabase = await serverClientRW();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) backToCode();
  redirect(next);
}
