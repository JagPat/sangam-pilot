import { existsSync, readFileSync } from 'node:fs';
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
const envExample = readFileSync(resolve(appRoot, '.env.example'), 'utf8');
const productionEnvExample = readFileSync(resolve(appRoot, '.env.production.example'), 'utf8');
const issueRoutePath = resolve(appRoot, 'app/api/test/invite-issue/route.ts');
const issueRoute = existsSync(issueRoutePath) ? readFileSync(issueRoutePath, 'utf8') : '';
const inviteIssuancePath = resolve(appRoot, 'lib/auth/inviteIssuance.ts');
const inviteIssuance = existsSync(inviteIssuancePath) ? readFileSync(inviteIssuancePath, 'utf8') : '';

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

  it('issues through the server-only command using only verified-session identity and row identifiers', () => {
    expect(manageActions).toContain('export async function issueGuestAccessLink');
    expect(manageActions).toContain('issueInviteForVerifiedUser(auth.user.id, weddingId, guestId)');
    expect(manageActions).toContain('buildInviteUrl(rawToken, siteOrigin)');
    expect(manageActions).not.toContain("from('household_contact')");
    expect(manageActions).not.toContain("rpc('issue_guest_access_link'");
    expect(manageActions).not.toContain("rpc('issue_access_link'");
    expect(manageActions).not.toContain('p_ttl');
    expect(manageActions).not.toMatch(/fd\.get\(['\"](?:email|contact|accountId|authUserId)['\"]\)/);
    expect(managePage).toContain('IssueAccessLinkForm');
  });

  it('returns an absolute invite URL from the configured canonical HTTPS site origin', () => {
    expect(manageActions).toContain('buildInviteUrl(rawToken, siteOrigin)');
    expect(inviteIssuance).toContain("configured.protocol !== 'https:'");
    expect(inviteIssuance).toContain("configured.pathname !== '/'");
    expect(inviteIssuance).toContain('new URL(`/invite/${encodeURIComponent(rawToken)}`, siteOrigin)');
    expect(envExample).toContain('PUBLIC_SITE_URL=');
    expect(productionEnvExample).toContain('PUBLIC_SITE_URL=https://');
    expect(manageActions).not.toContain("headers().get('host')");
    expect(manageActions).not.toContain("headers().get('origin')");
    expect(manageActions.indexOf('const siteOrigin = inviteSiteOrigin()')).toBeLessThan(
      manageActions.indexOf('issueInviteForVerifiedUser(auth.user.id, weddingId, guestId)'),
    );
  });

  it('does not claim the OTP flow left the guest unlinked', () => {
    expect(invitePage).not.toContain('Nothing has been linked yet.');
    expect(invitePage).toContain('Confirm to finish opening this invitation with this account.');
  });

  it('keeps the real-auth verifier route unavailable outside development and derives redemption from its session', () => {
    expect(testRedeemRoute).toContain("process.env.NODE_ENV === 'development'");
    expect(testRedeemRoute).toContain("process.env.SANGAM_REAL_AUTH_TEST === '1'");
    expect(testRedeemRoute).toContain('getVerifiedUser()');
    expect(testRedeemRoute).toContain('redeemInviteForVerifiedUser(token, user)');
    expect(issueRoute).toContain("process.env.NODE_ENV === 'development'");
    expect(issueRoute).toContain("process.env.SANGAM_REAL_AUTH_TEST === '1'");
    expect(issueRoute).toContain('getVerifiedUser()');
    expect(issueRoute).toContain('issueInviteForVerifiedUser(user.id, weddingId, guestId)');
  });

  it('proves intended-account replay is idempotent before testing cross-account replay denial', () => {
    expect(localVerifier).toContain('/api/test/invite-issue');
    expect(localVerifier).not.toContain("browser.schema('app').rpc('issue_guest_access_link'");
    expect(localVerifier).toContain('const intendedReplay = await fetch(redeemUrl');
    expect(localVerifier).toContain('headers: { cookie: intendedCookie }');
    expect(localVerifier).toContain("const crossAccountReplay = await admin.schema('app').rpc('redeem_and_bind'");
    expect(localVerifier).toContain('p_account: wrongAccount.data.id');
    expect(localVerifier).toContain('p_verified_contact: intendedEmail');
    expect(localVerifier).toContain('/link already used/i');
  });

  it('normalizes Supabase CLI environment names for the spawned verifier app', () => {
    expect(localVerifier).toContain('SUPABASE_URL: url');
    expect(localVerifier).toContain('SUPABASE_ANON_KEY: anonKey');
    expect(localVerifier).toContain('SUPABASE_SERVICE_ROLE_KEY: serviceKey');
    expect(localVerifier).toContain('PUBLIC_SITE_URL: baseUrl');
  });
});
