import { sendMagicLink, verifyCode } from './actions';

export const dynamic = 'force-dynamic';

const wrap = { padding: 24, maxWidth: 460, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 } as const;
const field = { display: 'block', width: '100%', padding: '10px 12px', fontSize: 16, marginBottom: 12 } as const;
const button = { padding: '10px 18px', fontSize: 16, cursor: 'pointer' } as const;
const divider = { margin: '24px 0 16px', borderTop: '1px solid #ddd' } as const;
const errStyle = { color: '#b00020' } as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string; email?: string }>;
}) {
  const { sent, error, next, email } = await searchParams;
  const nextPath = next ?? '/schedule';

  // Typed-code sign-in: robust on phones because a code (unlike a link) can't be consumed by
  // link-preview/scanner prefetch and needs no PKCE verifier cookie, so it works in any browser.
  const codeForm = (
    <form action={verifyCode}>
      <input type="hidden" name="next" value={nextPath} />
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        defaultValue={email ?? ''}
        style={field}
      />
      <input
        type="text"
        name="code"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        placeholder="Enter the code from your email"
        style={field}
      />
      <button type="submit" style={button}>Sign in with code</button>
    </form>
  );

  if (sent) {
    return (
      <main style={wrap}>
        <h1>Check your email</h1>
        <p>
          We sent you a sign-in email. Open the link on this device, <strong>or</strong> type the code from
          that email below — the code works even if the link opens in the wrong browser.
        </p>
        {error === 'code' && <p style={errStyle}>That code was incorrect or expired. Request a new one.</p>}
        {codeForm}
        <p style={{ color: '#555', fontSize: 14 }}>
          Use the same email your invitation was sent to — that&apos;s how we confirm it&apos;s you.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1>Sign in</h1>
      <p>Enter the email your wedding invitation was sent to and we&apos;ll email you a sign-in link and code.</p>
      {error === 'email' && <p style={errStyle}>Please enter your email address.</p>}
      {error === 'send' && <p style={errStyle}>We couldn&apos;t send the email just now. Please try again.</p>}
      {error === 'callback' && (
        <p style={errStyle}>That sign-in link was invalid or expired. Use the code from your email instead, or request a new one.</p>
      )}
      {error === 'code' && <p style={errStyle}>That code was incorrect or expired. Request a new one.</p>}

      <form action={sendMagicLink}>
        <input type="hidden" name="next" value={nextPath} />
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          style={field}
        />
        <button type="submit" style={button}>Email me a sign-in link</button>
      </form>

      <hr style={divider} />
      <p style={{ color: '#555', fontSize: 14, marginBottom: 8 }}>Already have a code from your email?</p>
      {codeForm}
    </main>
  );
}
