import type { VerifiedUser } from './session';

export function canUseInviteExchange(user: VerifiedUser | null): boolean {
  return Boolean(user?.emailConfirmed && user.email);
}
