import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const actions = readFileSync(resolve(process.cwd(), 'app/host/setup/actions.ts'), 'utf8');
const page = readFileSync(resolve(process.cwd(), 'app/host/setup/page.tsx'), 'utf8');

describe('wedding date-range UI contract', () => {
  it('rejects an end date before the start date before calling the database', () => {
    expect(actions).toContain("if (start && end && end < start) fail('dates')");
  });

  it('shows a specific correction message instead of a generic save failure', () => {
    expect(page).toContain("dates: { kind: 'err', text: 'The end date cannot be before the start date.' }");
    expect(page).toContain('End date cannot be before the start date.');
  });
});
