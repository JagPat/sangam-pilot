import { cookies } from 'next/headers';
import { type CookieOptions } from '@supabase/ssr';
import { userClient } from './clients';

// Read+WRITE server Supabase client for Route Handlers and Server Actions — the auth flows (send link,
// exchange code, sign out) MUST be able to set/clear the session cookies. Server Components must NOT write
// cookies (the middleware refreshes them there); those use the read-only reader in lib/auth/session.ts.
export async function serverClientRW() {
  const store = await cookies();
  return userClient({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
      cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
    },
  });
}
