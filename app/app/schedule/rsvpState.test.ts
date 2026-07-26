import { describe, expect, it } from 'vitest';
import { applyConfirmedRsvp, type RsvpClientState } from './rsvpState';

describe('applyConfirmedRsvp', () => {
  it('retains the committed row version for the next RSVP change', () => {
    const before: RsvpClientState = { status: 'accepted', rowVersion: 4 };

    expect(applyConfirmedRsvp(before, { status: 'declined', rowVersion: 5 })).toEqual({
      status: 'declined',
      rowVersion: 5,
    });
  });

  it('turns a first response into a versioned state', () => {
    const before: RsvpClientState = { status: null, rowVersion: null };

    expect(applyConfirmedRsvp(before, { status: 'accepted', rowVersion: 1 })).toEqual({
      status: 'accepted',
      rowVersion: 1,
    });
  });
});
