import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClientRW } from '@/lib/supabase/serverClient';

// Landing point for the magic-link / OTP email. Establishes the session cookies, then forwards to `next`.
// Supports both the PKCE `code` flow (@supabase/ssr default) and the `token_hash`+`type` email template.
//
// Redirects use RELATIVE Location headers on purpose. Behind a reverse proxy (Coolify/Traefik) a Route
// Handler's `request.url` carries the INTERNAL host (e.g. localhost:3000), so an absolute redirect built
// from it sends the browser to the wrong origin. A relative Location is resolved by the browser against
// the address bar (the real external host), which is correct in every environment. The session cookies are
// written via the next/headers cookie store, so they attach to whatever response we return.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  // `next` must be a same-origin absolute path — reject `//evil.com`, `https://…`, etc. (open-redirect guard;
  // it is resolved as a relative Location below, where a protocol-relative value would escape the origin).
  const rawNext = url.searchParams.get('next') ?? '/schedule';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/schedule';

  const supabase = await serverClientRW();
  const redirectTo = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectTo('/login?error=callback');
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return redirectTo('/login?error=callback');
  } else {
    return redirectTo('/login?error=callback');
  }

  return redirectTo(next);
}
