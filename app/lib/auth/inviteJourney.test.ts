import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = process.cwd();
const invitePage = readFileSync(resolve(appRoot, 'app/invite/[token]/page.tsx'), 'utf8');
const loginActions = readFileSync(resolve(appRoot, 'app/login/actions.ts'), 'utf8');
const authCallback = readFileSync(resolve(appRoot, 'app/auth/callback/route.ts'), 'utf8');
const accessPage = readFileSync(resolve(appRoot, 'app/access/page.tsx'), 'utf8');
const accessActions = readFileSync(resolve(appRoot, 'app/access/actions.ts'), 'utf8');
const testRedeemRoute = readFileSync(resolve(appRoot, 'app/api/test/invite-redeem/[token]/route.ts'), 'utf8');
const localVerifier = readFileSync(resolve(appRoot, 'scripts/verify-supabase-local.mjs'), 'utf8');
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
    expect(loginActions).toContain("withSafeNext('/access?reason=account_link_failed', safeNext)");
    expect(authCallback).toContain("withSafeNext('/login?error=callback', nextParam)");
    expect(authCallback).toContain("withSafeNext('/access?reason=account_link_failed', nextParam)");
    expect(accessPage).toContain('name="next"');
    expect(accessPage).toContain("withSafeNext('/access', safeNext)");
    expect(accessActions).toContain("withSafeNext('/access', next)");
    expect(accessActions).toContain('postAuthDestination(next, nav.sections, creator.canCreateWedding)');
  });

  it('issues a link only from database-authorized row identifiers and server-derived contact', () => {
    expect(manageActions).toContain('export async function issueGuestAccessLink');
    expect(manageActions).toContain("rpc('issue_guest_access_link'");
    expect(manageActions).not.toContain("from('household_contact')");
    expect(manageActions).not.toContain("rpc('issue_access_link'");
    expect(manageActions).not.toMatch(/fd\.get\(['\"](?:email|contact|accountId|authUserId)['\"]\)/);
    expect(managePage).toContain('IssueAccessLinkForm');
  });

  it('keeps the real-auth verifier route unavailable outside development and derives redemption from its session', () => {
    expect(testRedeemRoute).toContain("process.env.NODE_ENV === 'development'");
    expect(testRedeemRoute).toContain("process.env.SANGAM_REAL_AUTH_TEST === '1'");
    expect(testRedeemRoute).toContain('getVerifiedUser()');
    expect(testRedeemRoute).toContain('redeemInviteForVerifiedUser(token, user)');
  });

  it('proves intended-account replay is idempotent before testing cross-account replay denial', () => {
    expect(localVerifier).toContain('const intendedReplay = await fetch(redeemUrl');
    expect(localVerifier).toContain('headers: { cookie: intendedCookie }');
    expect(localVerifier).toContain("const crossAccountReplay = await admin.schema('app').rpc('redeem_and_bind'");
    expect(localVerifier).toContain('p_account: wrongAccount.data.id');
    expect(localVerifier).toContain('p_verified_contact: intendedEmail');
    expect(localVerifier).toContain('/link already used/i');
  });
});
