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
  redirect('/login?sent=1');
}
