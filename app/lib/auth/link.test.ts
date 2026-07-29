import { describe, expect, it, vi } from 'vitest';
import { linkSignedInAccountWith } from './link';

describe('linkSignedInAccountWith', () => {
  it('returns the linked application account id', async () => {
    await expect(linkSignedInAccountWith('auth-1', async () => 'account-1')).resolves.toEqual({
      ok: true,
      accountId: 'account-1',
    });
  });

  it('reports a retryable setup failure instead of silently succeeding', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await linkSignedInAccountWith('auth-1', async () => {
      throw new Error('database unavailable');
    });

    expect(result).toEqual({ ok: false, reason: 'account_link_failed' });
    errorLog.mockRestore();
  });
});
