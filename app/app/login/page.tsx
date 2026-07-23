import { sendMagicLink, verifyCode } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string; email?: string }>;
}) {
  const { sent, error, next, email } = await searchParams;
  const nextPath = next ?? '/schedule';

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
        <label htmlFor="code">6-digit code</label>
        <input
          id="code"
          className="sg-input"
          type="text"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
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
                  We sent a sign-in link and code to <strong>{email}</strong>.
                </>
              ) : (
                'We sent you a sign-in link and code.'
              )}
            </p>
          </header>

          <div className="sg-card">
            {error === 'code' && (
              <div className="sg-banner is-err">That code was incorrect or expired. Request a new one.</div>
            )}

            <p style={{ marginTop: 0 }}>
              Open the link on this device, <strong>or</strong> type the code from that email below — the code
              works even if the link opens in the wrong browser.
            </p>

            {codeForm(true)}

            <div className="sg-ornament">
              <span />
              <b>Didn&apos;t get it?</b>
              <span />
            </div>

            <form action={sendMagicLink}>
              <input type="hidden" name="next" value={nextPath} />
              <input type="hidden" name="email" value={email ?? ''} />
              <button type="submit" className="sg-btn sg-btn--block">Resend the email</button>
            </form>

            <p className="sg-muted" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>
              Use the same email your invitation was sent to — that&apos;s how we confirm it&apos;s you.
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
          {error === 'email' && <div className="sg-banner is-err">Please enter your email address.</div>}
          {error === 'send' && (
            <div className="sg-banner is-err">We couldn&apos;t send the email just now. Please try again.</div>
          )}
          {error === 'callback' && (
            <div className="sg-banner is-err">
              That sign-in link was invalid or expired. Use the code from your email instead, or request a new one.
            </div>
          )}
          {error === 'code' && (
            <div className="sg-banner is-err">That code was incorrect or expired. Request a new one.</div>
          )}

          <p style={{ marginTop: 0 }}>
            Enter the email your wedding invitation was sent to and we&apos;ll email you a sign-in link and code.
          </p>

          <form action={sendMagicLink}>
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
              Email me a sign-in link
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
