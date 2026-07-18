import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Landing point for the magic-link / OTP email. Establishes the session cookies, then forwards to `next`.
// Supports both the PKCE `code` flow (@supabase/ssr default) and the `token_hash`+`type` email template.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = url.searchParams.get('next') ?? '/schedule';

  const supabase = await serverClientRW();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL('/login?error=callback', url.origin));
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return NextResponse.redirect(new URL('/login?error=callback', url.origin));
  } else {
    return NextResponse.redirect(new URL('/login?error=callback', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
