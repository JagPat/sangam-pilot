import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClientRW } from '@/lib/supabase/serverClient';
import type { AppSupabaseClient } from '@/lib/supabase/clients';
import { linkSignedInAccount } from '@/lib/auth/link';
import { getOrganizerNav } from '@/lib/data/nav';

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
  const nextParam = url.searchParams.get('next');
  const rawNext = nextParam ?? '/schedule';
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

  // Bind this account to any guest invited at their verified email (best-effort; never blocks sign-in).
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user) await linkSignedInAccount(userData.user.id);

  // Default landing: a wedding owner (event manager) is usually also a guest, so without an explicit
  // destination send them to the organizer console rather than their own guest schedule. Best-effort —
  // never blocks sign-in; an explicit `next` (e.g. a deep link into an event) always wins.
  let dest = next;
  if (!nextParam) {
    try {
      const nav = await getOrganizerNav(supabase as unknown as AppSupabaseClient);
      // Land on the first section this role can use: the owner's is the Dashboard (/host); a family
      // admin's is their scoped Guests screen (/host/manage).
      if (nav.sections.length > 0) dest = nav.sections[0].href;
    } catch {
      /* fall back to the default guest landing */
    }
  }

  return redirectTo(dest);
}
