import { describe, expect, it } from 'vitest';
import { fetchAllPages } from './paging';

describe('fetchAllPages', () => {
  it('retrieves more than Supabase default 1000 rows in deterministic pages', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
    const result = await fetchAllPages(async (from, to) => rows.slice(from, to + 1), 500);
    expect(result).toHaveLength(1001);
    expect(result.at(-1)?.id).toBe(1000);
  });
});
