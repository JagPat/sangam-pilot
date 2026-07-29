import { sendSignInCode, verifyCode } from './actions';
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth/session';
import type { SessionFailureReason } from '@/lib/auth/sessionState';
import { loginDestinationForSession } from '@/lib/auth/loginDecision';
import { getOrganizerNav } from '@/lib/data/nav';
import { pageClient } from '@/lib/supabase/pageClient';
import { getCreatorAccess } from '@/lib/data/creator-access';
import { ResendCodeButton } from './ResendCodeButton';
import { safeInternalPath } from '@/lib/auth/landing';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    error?: string;
    next?: string;
    email?: string;
    reason?: SessionFailureReason;
  }>;
}) {
  const { sent, error, next, email, reason } = await searchParams;
  const nextPath = next ? safeInternalPath(next, '/schedule') : '';

  const user = await getVerifiedUser();
  let sections: { href: string }[] = [];
  let canCreateWedding = false;
  if (user) {
    try {
      const db = await pageClient();
      const [nav, creator] = await Promise.all([getOrganizerNav(db), getCreatorAccess(db)]);
      sections = nav.sections;
      canCreateWedding = creator.canCreateWedding;
    } catch {
      // Authentication succeeded; navigation enrichment is best-effort.
    }
  }
  const destination = loginDestinationForSession(user, next ?? null, sections, canCreateWedding);
  if (destination) redirect(destination);

  // Typed-code sign-in: robust on phones because a code (unlike a link) can't be consumed by
  // link-preview/scanner prefetch and needs no PKCE verifier cookie, so it works in any browser.
  const codeForm = (primary: boolean) => (
    <form action={verifyCode}>
      <input type="hidden" name="next" value={nextPath} />
      <div className="sg-field">
        <label htmlFor="code-email">Email address</label>
        <input
          id="code-email"
          className="sg-input"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={email ?? ''}
        />
      </div>
      <div className="sg-field" style={{ marginTop: 12 }}>
        <label htmlFor="code">6-digit sign-in code</label>
        <input
          id="code"
          className="sg-input"
          type="text"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          minLength={6}
          maxLength={6}
          pattern="[0-9]{6}"
          placeholder="Enter the code from your email"
        />
      </div>
      <button
        type="submit"
        className={'sg-btn sg-btn--block' + (primary ? ' sg-btn--primary' : '')}
        style={{ marginTop: 16 }}
      >
        Sign in with code
      </button>
    </form>
  );

  if (sent) {
    return (
      <main className="sg-guest">
        <div className="sg-shell" style={{ maxWidth: 420 }}>
          <header className="sg-hero">
            <div className="sg-eyebrow">Almost there</div>
            <h1>Check your email</h1>
            <p>
              {email ? (
                <>
                  We sent a sign-in code to <strong>{email}</strong>.
                </>
              ) : (
                'We sent you a sign-in code.'
              )}
            </p>
          </header>

          <div className="sg-card">
            {error === 'code' && (
              <div className="sg-banner is-err">That code was incorrect or expired. Request a new one.</div>
            )}

            <p style={{ marginTop: 0 }}>
              Type the six-digit code from the newest email below. It is valid for 60 minutes.
            </p>

            {codeForm(true)}

            <div className="sg-ornament">
              <span />
              <b>Didn&apos;t get it?</b>
              <span />
            </div>

            <ResendCodeButton action={sendSignInCode} email={email ?? ''} nextPath={nextPath} />

            <p className="sg-muted" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>
              Only the newest code works. Delivery can take a moment, so wait for the countdown before sending
              another. Use the same email your invitation was sent to — that&apos;s how we confirm it&apos;s you.
            </p>
          </div>

          <div className="sg-foot">Sangam · two families, one celebration</div>
        </div>
      </main>
    );
  }

  return (
    <main className="sg-guest">
      <div className="sg-shell" style={{ maxWidth: 420 }}>
        <header className="sg-hero">
          <div className="sg-eyebrow">Welcome</div>
          <h1>Sangam</h1>
          <p>Sign in to your wedding</p>
        </header>

        <div className="sg-card">
          {reason === 'refresh_failed' && (
            <div className="sg-banner is-err">
              Your saved sign-in could not be refreshed. Please verify once more on this device.
            </div>
          )}
          {error === 'email' && <div className="sg-banner is-err">Please enter your email address.</div>}
          {error === 'send' && (
            <div className="sg-banner is-err">We couldn&apos;t send the email just now. Please try again.</div>
          )}
          {error === 'callback' && (
            <div className="sg-banner is-err">
              That sign-in request expired. Request a new code and use the newest email.
            </div>
          )}
          {error === 'code' && (
            <div className="sg-banner is-err">That code was incorrect or expired. Request a new one.</div>
          )}

          <p style={{ marginTop: 0 }}>
            Enter the email your wedding invitation was sent to and we&apos;ll email you a six-digit sign-in code.
          </p>

          <form action={sendSignInCode}>
            <input type="hidden" name="next" value={nextPath} />
            <div className="sg-field">
              <label htmlFor="signin-email">Email address</label>
              <input
                id="signin-email"
                className="sg-input"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
            <button type="submit" className="sg-btn sg-btn--primary sg-btn--block" style={{ marginTop: 16 }}>
              Email me a sign-in code
            </button>
          </form>

          <div className="sg-ornament">
            <span />
            <b>Have a code?</b>
            <span />
          </div>

          {codeForm(false)}
        </div>

        <div className="sg-foot">Sangam · two families, one celebration</div>
      </div>
    </main>
  );
}
