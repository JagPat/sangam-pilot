import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '../database.types';

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;

// Refreshes the Supabase auth token on every matched request and propagates the rotated cookies to BOTH
// the request (so Server Components in this same pass read the fresh session) and the outgoing response
// (so the browser stores them). Without this, a read-only handler such as getVerifiedUser() cannot
// rotate an expired token, and sessions silently die. This is the "session refresh" path the invite
// exchange depends on.
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(URL, ANON, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Must be getUser() (validates + refreshes with the auth server), not getSession(). Do NOT insert code
  // between createServerClient and getUser — Supabase's documented caveat to avoid dropped refreshes.
  await supabase.auth.getUser();

  return response;
}
