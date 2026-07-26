export type SessionFailureReason = 'no_cookie' | 'refresh_failed';

type NamedCookie = { name: string; value: string };

export function sessionFailureReason(cookies: readonly NamedCookie[]): SessionFailureReason {
  const hadCredential = cookies.some(
    ({ name, value }) => name.includes('auth-token') && value.length > 0,
  );
  return hadCredential ? 'refresh_failed' : 'no_cookie';
}
