import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE_MAX_AGE_SECONDS, authCookieOptions } from './authCookieOptions';

describe('authCookieOptions', () => {
  it('persists the browser credential for the browser maximum', () => {
    expect(AUTH_COOKIE_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
    expect(authCookieOptions(true)).toMatchObject({
      path: '/',
      sameSite: 'lax',
      secure: true,
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    });
  });

  it('allows local HTTP development', () => {
    expect(authCookieOptions(false).secure).toBe(false);
  });
});
