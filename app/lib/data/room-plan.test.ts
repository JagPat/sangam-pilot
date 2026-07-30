import { describe, expect, it } from 'vitest';
import { displayRoomIdentity, occupancyLabel, classifyRoomWarnings, staleRoomMessage } from './room-plan';

describe('room plan presentation', () => {
  it('prefers a physical number without losing the provisional code', () => {
    expect(displayRoomIdentity({ provisionalCode: 'SUR-001', physicalRoomNumber: '204' })).toEqual({ primary: '204', planningCode: 'SUR-001' });
    expect(displayRoomIdentity({ provisionalCode: 'SUR-001', physicalRoomNumber: null })).toEqual({ primary: 'SUR-001', planningCode: null });
  });

  it('uses explicit occupancy policy labels', () => {
    expect(occupancyLabel('single')).toBe('Single · exception');
    expect(occupancyLabel('double')).toBe('Double');
    expect(occupancyLabel('triple')).toBe('Triple · explicitly approved');
  });

  it('groups structured warnings without inferring roommates', () => {
    expect(classifyRoomWarnings(['sharing_unconfirmed', 'single_reason_missing', 'physical_number_missing'])).toEqual({
      blocking: ['Single occupancy needs a reason', 'Confirm the exact sharing group'],
      advisory: ['Physical room number pending'],
    });
  });

  it('has safe copy for optimistic conflicts', () => {
    expect(staleRoomMessage()).toContain('changed since');
  });
});
