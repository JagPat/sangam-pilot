import { afterEach, describe, expect, it } from 'vitest';
import { buildInviteUrl } from './inviteIssuance';

const originalPublicSiteUrl = process.env.PUBLIC_SITE_URL;

afterEach(() => {
  if (originalPublicSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = originalPublicSiteUrl;
});

describe('buildInviteUrl', () => {
  it('builds an absolute invite URL from the configured canonical HTTPS origin', () => {
    process.env.PUBLIC_SITE_URL = 'https://sangam.example';
    expect(buildInviteUrl('raw/token')).toBe('https://sangam.example/invite/raw%2Ftoken');
  });

  it.each([
    'http://sangam.example',
    'https://user:secret@sangam.example',
    'https://sangam.example/path',
    'https://sangam.example/%2e%2e',
    'https://sangam.example?tenant=other',
    'https://sangam.example#other',
  ])('rejects a non-canonical or non-HTTPS configured site URL (%s)', (configured) => {
    process.env.PUBLIC_SITE_URL = configured;
    expect(() => buildInviteUrl('raw-token')).toThrow(/HTTPS origin/);
  });
});
