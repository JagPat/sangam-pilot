import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { userClient } from '../supabase/clients';
import { sessionFailureReason, type SessionFailureReason } from './sessionState';

// Identity comes ONLY from a verified Supabase session — never from the URL or any client input.
// auth.getUser() validates the JWT with the auth server (unlike getSession, which just reads the cookie).
// The read-only cookie adapter below intentionally does not write cookies: token *refresh* is done by the
// Next middleware (lib/supabase/middleware.ts), which runs before this and persists rotated cookies.

export type VerifiedUser = { id: string; email: string | null; emailConfirmed: boolean };
export type VerifiedUserResult =
  | { user: VerifiedUser; reason: null }
  | { user: null; reason: SessionFailureReason };

export async function getVerifiedUserResult(): Promise<VerifiedUserResult> {
  const store = await cookies();
  const requestCookies = store.getAll().map(({ name, value }) => ({ name, value }));
  const supabase = userClient({
    getAll: () => requestCookies,
    setAll: () => {}, // read-only here; middleware owns cookie refresh
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { user: null, reason: sessionFailureReason(requestCookies) };
  }
  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    },
    reason: null,
  };
}

// Full verified user. `emailConfirmed` gives the "confirmed-email assurance" the invite exchange requires
// (a magic-link sign-in confirms the address; we still check rather than assume).
export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  return (await getVerifiedUserResult()).user;
}

// Just the id — the authority for binding. Null if no valid session is present.
export async function getVerifiedAuthUserId(): Promise<string | null> {
  return (await getVerifiedUser())?.id ?? null;
}

// For protected pages: send anonymous visitors to /login, preserving where they were headed.
export async function requireVerifiedUser(nextPath = '/schedule'): Promise<VerifiedUser> {
  const result = await getVerifiedUserResult();
  if (!result.user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}&reason=${result.reason}`);
  }
  return result.user;
}
