import { describe, expect, it } from 'vitest';
import { postAuthDestination, safeInternalPath } from './landing';

describe('safeInternalPath', () => {
  it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)', 'schedule'])(
    'rejects %s',
    (value) => expect(safeInternalPath(value, '/schedule')).toBe('/schedule'),
  );

  it('accepts an internal path with query and fragment', () => {
    expect(safeInternalPath('/schedule?day=2#event', '/schedule')).toBe('/schedule?day=2#event');
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
});
