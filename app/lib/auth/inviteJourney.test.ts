import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = process.cwd();
const invitePage = readFileSync(resolve(appRoot, 'app/invite/[token]/page.tsx'), 'utf8');
const loginActions = readFileSync(resolve(appRoot, 'app/login/actions.ts'), 'utf8');
const manageActions = readFileSync(resolve(appRoot, 'app/host/manage/actions.ts'), 'utf8');
const managePage = readFileSync(resolve(appRoot, 'app/host/manage/page.tsx'), 'utf8');

describe('recipient-bound invitation journey contract', () => {
  it('sends a signed-out valid invite to login while retaining its invite destination', () => {
    expect(invitePage).toContain('href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}');
  });

  it('retains the validated destination through OTP send, failure, sent, and code-error states', () => {
    expect(loginActions).toContain("withSafeNext('/login?error=email', next)");
    expect(loginActions).toContain("withSafeNext('/login?error=send', next)");
    expect(loginActions).toContain("withSafeNext(`/login?sent=1&email=${encodeURIComponent(email)}`, next)");
    expect(loginActions).toContain("withSafeNext(`/login?error=code&email=${encodeURIComponent(email)}`, next)");
  });

  it('issues a link only from database-authorized row identifiers and server-derived contact', () => {
    expect(manageActions).toContain('export async function issueGuestAccessLink');
    expect(manageActions).toContain("from('household_contact')");
    expect(manageActions).toContain("rpc('issue_access_link'");
    expect(manageActions).not.toMatch(/fd\.get\(['\"](?:email|contact|accountId|authUserId)['\"]\)/);
    expect(managePage).toContain('IssueAccessLinkForm');
  });
});
