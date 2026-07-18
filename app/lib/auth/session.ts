import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { userClient } from '../supabase/clients';

// Identity comes ONLY from a verified Supabase session — never from the URL or any client input.
// auth.getUser() validates the JWT with the auth server (unlike getSession, which just reads the cookie).
// The read-only cookie adapter below intentionally does not write cookies: token *refresh* is done by the
// Next middleware (lib/supabase/middleware.ts), which runs before this and persists rotated cookies.

async function verifiedUser() {
  const store = await cookies();
  const supabase = userClient({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: () => {}, // read-only here; middleware owns cookie refresh
  });
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export type VerifiedUser = { id: string; email: string | null; emailConfirmed: boolean };

// Full verified user. `emailConfirmed` gives the "confirmed-email assurance" the invite exchange requires
// (a magic-link sign-in confirms the address; we still check rather than assume).
export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  const u = await verifiedUser();
  if (!u) return null;
  return { id: u.id, email: u.email ?? null, emailConfirmed: Boolean(u.email_confirmed_at) };
}

// Just the id — the authority for binding. Null if no valid session is present.
export async function getVerifiedAuthUserId(): Promise<string | null> {
  return (await verifiedUser())?.id ?? null;
}

// For protected pages: send anonymous visitors to /login, preserving where they were headed.
export async function requireVerifiedUser(nextPath = '/schedule'): Promise<VerifiedUser> {
  const u = await getVerifiedUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return u;
}
