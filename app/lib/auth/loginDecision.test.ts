import { describe, expect, it } from 'vitest';
import { loginDestinationForSession } from './loginDecision';

const verifiedUser = { id: 'u1', email: 'guest@example.test', emailConfirmed: true };

describe('loginDestinationForSession', () => {
  it('sends an authenticated guest to the schedule without another OTP', () => {
    expect(loginDestinationForSession(verifiedUser, null, [])).toBe('/schedule');
  });

  it('honors a safe requested destination for an authenticated user', () => {
    expect(loginDestinationForSession(verifiedUser, '/directory', [{ href: '/host' }])).toBe('/directory');
  });

  it('uses the first organizer destination when none was requested', () => {
    expect(loginDestinationForSession(verifiedUser, null, [{ href: '/host/manage' }])).toBe('/host/manage');
  });

  it('renders the login form for an anonymous visitor', () => {
    expect(loginDestinationForSession(null, null, [])).toBeNull();
  });

  it('returns an existing session for a provisioned creator to setup without another OTP', () => {
    expect(loginDestinationForSession(verifiedUser, null, [], true)).toBe('/host/setup');
  });
});
