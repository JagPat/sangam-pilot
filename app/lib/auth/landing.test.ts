import { describe, expect, it } from 'vitest';
import { postAuthDestination, safeInternalPath, withSafeNext } from './landing';

describe('safeInternalPath', () => {
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%5Cevil.example',
    '/%09/evil.example',
    '/%0a/evil.example',
    '/%2f%2fevil.example',
    'javascript:alert(1)',
    'schedule',
  ])(
    'rejects %s',
    (value) => expect(safeInternalPath(value, '/schedule')).toBe('/schedule'),
  );

  it('accepts an internal path with query and fragment', () => {
    expect(safeInternalPath('/schedule?day=2#event', '/schedule')).toBe('/schedule?day=2#event');
  });

  it('returns only the canonical internal path, query, and fragment', () => {
    expect(safeInternalPath('/schedule/../invite?day=2#rsvp', '/schedule')).toBe('/invite?day=2#rsvp');
  });
});

describe('postAuthDestination', () => {
  it('honors a safe explicit destination', () => {
    expect(postAuthDestination('/directory', [{ href: '/host' }])).toBe('/directory');
  });

  it('rejects an unsafe explicit destination', () => {
    expect(postAuthDestination('//evil.example', [{ href: '/host' }])).toBe('/host');
  });

  it('uses the first authorized organizer section when no destination was requested', () => {
    expect(postAuthDestination(null, [{ href: '/host/manage' }])).toBe('/host/manage');
  });

  it('uses the guest schedule when no organizer section exists', () => {
    expect(postAuthDestination(undefined, [])).toBe('/schedule');
  });

  it('sends a provisioned wedding creator without an existing role to setup', () => {
    expect(postAuthDestination(null, [], true)).toBe('/host/setup');
  });
});

describe('withSafeNext', () => {
  it('keeps a valid invite destination across OTP state redirects', () => {
    expect(withSafeNext('/login?sent=1&email=guest%40example.test', '/invite/invite-token')).toBe(
      '/login?sent=1&email=guest%40example.test&next=%2Finvite%2Finvite-token',
    );
  });

  it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)'])(
    'falls back to the schedule for unsafe destinations (%s)',
    (next) => expect(withSafeNext('/login?error=send', next)).toBe('/login?error=send&next=%2Fschedule'),
  );

  it('does not add a destination when none was requested', () => {
    expect(withSafeNext('/login?sent=1', null)).toBe('/login?sent=1');
  });
});
