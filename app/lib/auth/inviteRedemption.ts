import type { VerifiedUser } from './session';
import { redeemInvite } from './accessLink';
import { canUseInviteExchange } from './inviteEligibility';

// Shared by the production server action and the real-auth verifier route. The only account/contact inputs
// are a user already verified by getUser(); callers cannot supply an account id or recipient contact.
export async function redeemInviteForVerifiedUser(rawToken: string, user: VerifiedUser | null) {
  if (process.env.INVITE_EXCHANGE_ENABLED !== '1') throw new Error('invite exchange disabled');
  if (!user || !canUseInviteExchange(user) || !user.email) throw new Error('verified recipient session required');
  return redeemInvite(rawToken, user.id, user.email);
}
