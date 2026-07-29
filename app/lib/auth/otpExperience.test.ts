import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '..');
const loginPage = readFileSync(resolve(process.cwd(), 'app/login/page.tsx'), 'utf8');
const loginActions = readFileSync(resolve(process.cwd(), 'app/login/actions.ts'), 'utf8');
const authConfig = readFileSync(resolve(repoRoot, 'supabase/config.toml'), 'utf8');
const templatePath = resolve(repoRoot, 'supabase/templates/magic_link.html');
const emailTemplate = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';

describe('email OTP experience contract', () => {
  it('presents the sign-in method as a code rather than promising a link', () => {
    expect(loginPage).toContain('Email me a sign-in code');
    expect(loginPage).not.toContain('sign-in link and code');
    expect(loginPage).not.toContain('Open the link on this device');
  });

  it('keeps the UI and provider on one six-digit policy', () => {
    expect(authConfig).toMatch(/otp_length\s*=\s*6/);
    expect(loginPage).toContain('6-digit sign-in code');
    expect(loginPage).toContain('maxLength={6}');
    expect(loginPage).toContain('pattern="[0-9]{6}"');
    expect(loginActions).toContain('/^[0-9]{6}$/');
  });

  it('uses a code-only email so link scanners cannot consume the OTP', () => {
    expect(existsSync(templatePath)).toBe(true);
    expect(emailTemplate).toContain('{{ .Token }}');
    expect(emailTemplate).not.toContain('.ConfirmationURL');
    expect(authConfig).toContain('[auth.email.template.magic_link]');
  });

  it('explains expiry, resend delay, and newest-code behavior', () => {
    expect(loginPage).toContain('valid for 60 minutes');
    expect(loginPage).toContain('Only the newest code works');
    expect(loginPage).toContain('ResendCodeButton');
  });
});
