import { NextResponse } from 'next/server';
import { serverClientRW } from '@/lib/supabase/serverClient';

// POST-only sign out (a plain form button). Clears the Supabase session cookies, returns to /login.
// Relative Location on purpose (see auth/callback/route.ts): behind a reverse proxy an absolute redirect
// built from `request.url` would target the internal host; the browser resolves a relative Location
// against the real external origin. Cookie clears attach via the next/headers cookie store.
export async function POST(): Promise<NextResponse> {
  const supabase = await serverClientRW();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
