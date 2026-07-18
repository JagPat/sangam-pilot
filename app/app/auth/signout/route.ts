import { NextResponse, type NextRequest } from 'next/server';
import { serverClientRW } from '@/lib/supabase/serverClient';

// POST-only sign out (a plain form button). Clears the Supabase session cookies, returns to /login.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await serverClientRW();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', new URL(request.url).origin), { status: 303 });
}
