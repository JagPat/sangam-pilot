import { describe, expect, it } from 'vitest';
import { sessionFailureReason } from './sessionState';

describe('sessionFailureReason', () => {
  it('reports no_cookie when no Supabase credential exists', () => {
    expect(sessionFailureReason([])).toBe('no_cookie');
  });

  it('reports refresh_failed without exposing the cookie value', () => {
    expect(sessionFailureReason([{ name: 'sb-project-auth-token.0', value: 'secret' }])).toBe('refresh_failed');
  });

  it('ignores empty and unrelated cookies', () => {
    expect(sessionFailureReason([
      { name: 'theme', value: 'dark' },
      { name: 'sb-project-auth-token', value: '' },
    ])).toBe('no_cookie');
  });
});
