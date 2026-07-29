import { describe, expect, it } from 'vitest';
import { CREATOR_ACCESS_OPTIONS, PLATFORM_CREATOR_LABEL } from './platform';

describe('platform wedding-creator model', () => {
  it('describes an account capability rather than a wedding role', () => {
    expect(PLATFORM_CREATOR_LABEL).toBe('May create client weddings');
    expect(CREATOR_ACCESS_OPTIONS).toEqual([
      { value: 'true', label: 'Enable' },
      { value: 'false', label: 'Disable' },
    ]);
  });
});
