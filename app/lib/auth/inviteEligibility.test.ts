import { describe, expect, it } from 'vitest';
import { canUseInviteExchange } from './inviteEligibility';

describe('canUseInviteExchange', () => {
  it('requires a confirmed email identity', () => {
    expect(canUseInviteExchange({ id: 'u', email: 'g@example.test', emailConfirmed: false })).toBe(false);
    expect(canUseInviteExchange({ id: 'u', email: null, emailConfirmed: true })).toBe(false);
    expect(canUseInviteExchange({ id: 'u', email: 'g@example.test', emailConfirmed: true })).toBe(true);
  });
});
