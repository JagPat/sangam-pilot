import { describe, expect, it } from 'vitest';
import { diffRoomSheetChange } from './roomSheetDiff';

describe('room sheet diff', () => {
  it('returns only editable changed fields in deterministic order', () => {
    expect(diffRoomSheetChange(
      { occupancyPlan: 'double', guestIds: ['a','b'], checkIn: null, checkOut: null, singleReason: null, status: 'held', notes: null },
      { occupancyPlan: 'triple', guestIds: ['a','b','c'], checkIn: null, checkOut: null, singleReason: null, status: 'held', notes: 'Children' },
    )).toEqual(['occupancyPlan','guestIds','notes']);
  });
});
