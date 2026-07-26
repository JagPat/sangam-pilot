import type { CookieOptions } from '@supabase/ssr';

export const AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function authCookieOptions(isProduction = process.env.NODE_ENV === 'production'): CookieOptions {
  return {
    path: '/',
    sameSite: 'lax',
    secure: isProduction,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}
