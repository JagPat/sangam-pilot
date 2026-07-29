import { describe, expect, it } from 'vitest';
import { canRenderWeddingCreation } from './creator-access';

describe('canRenderWeddingCreation', () => {
  it('shows creation only for an explicitly provisioned account', () => {
    expect(canRenderWeddingCreation({ canCreateWedding: true })).toBe(true);
    expect(canRenderWeddingCreation({ canCreateWedding: false })).toBe(false);
  });
});
