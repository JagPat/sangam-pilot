import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClientRW } from '@/lib/supabase/serverClient';
import type { AppSupabaseClient } from '@/lib/supabase/clients';
import { linkSignedInAccount } from '@/lib/auth/link';
import { getOrganizerNav } from '@/lib/data/nav';
import { postAuthDestination, withSafeNext } from '@/lib/auth/landing';
import { getCreatorAccess } from '@/lib/data/creator-access';

// Compatibility landing point for older sign-in emails and explicit auth callbacks. Sangam's current
// guest email is code-only so mail scanners cannot consume the token before the guest enters it.
// Supports both the PKCE `code` flow (@supabase/ssr default) and token_hash+type callbacks.
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
  const supabase = await serverClientRW();
  const redirectTo = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectTo(withSafeNext('/login?error=callback', nextParam));
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return redirectTo(withSafeNext('/login?error=callback', nextParam));
  } else {
    return redirectTo(withSafeNext('/login?error=callback', nextParam));
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return redirectTo(withSafeNext('/login?error=callback', nextParam));
  const linkResult = await linkSignedInAccount(userData.user.id);
  if (!linkResult.ok) return redirectTo(withSafeNext('/access?reason=account_link_failed', nextParam));

  // Default landing: a wedding owner (event manager) is usually also a guest, so without an explicit
  // destination send them to the organizer console rather than their own guest schedule. Best-effort —
  // never blocks sign-in; an explicit `next` (e.g. a deep link into an event) always wins.
  let sections: { href: string }[] = [];
  let canCreateWedding = false;
  if (nextParam == null) {
    try {
      const appDb = supabase as unknown as AppSupabaseClient;
      const [nav, creator] = await Promise.all([getOrganizerNav(appDb), getCreatorAccess(appDb)]);
      sections = nav.sections;
      canCreateWedding = creator.canCreateWedding;
    } catch {
      // Fall back to the guest schedule.
    }
  }
  return redirectTo(postAuthDestination(nextParam, sections, canCreateWedding));
}
