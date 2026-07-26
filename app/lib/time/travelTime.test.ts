import { describe, expect, it } from 'vitest';
import { travelInputValue } from './travelTime';

describe('travelInputValue', () => {
  it('preserves the submitted wall clock instead of slicing the UTC instant', () => {
    expect(travelInputValue('2026-11-01T01:30:00', '2026-11-01T05:30:00Z')).toBe('2026-11-01T01:30');
  });

  it('uses the instant only as a legacy fallback', () => {
    expect(travelInputValue(null, '2026-07-30T08:15:00Z')).toBe('2026-07-30T08:15');
  });
});
