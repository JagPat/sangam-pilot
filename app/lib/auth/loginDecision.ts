import { postAuthDestination } from './landing';

type AuthenticatedUser = { id: string };
type DestinationSection = { href: string };

export function loginDestinationForSession(
  user: AuthenticatedUser | null,
  nextParam: string | null | undefined,
  sections: readonly DestinationSection[],
): string | null {
  return user ? postAuthDestination(nextParam, sections) : null;
}
