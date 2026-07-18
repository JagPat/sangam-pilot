import { sendMagicLink } from './actions';

export const dynamic = 'force-dynamic';

const wrap = { padding: 24, maxWidth: 460, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 } as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const { sent, error, next } = await searchParams;

  if (sent) {
    return (
      <main style={wrap}>
        <h1>Check your email</h1>
        <p>We sent you a sign-in link. Open it on this device to continue to your schedule.</p>
        <p style={{ color: '#555', fontSize: 14 }}>
          Use the same email your invitation was sent to — that&apos;s how we confirm it&apos;s you.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1>Sign in</h1>
      <p>Enter the email your wedding invitation was sent to and we&apos;ll email you a sign-in link.</p>
      {error === 'email' && <p style={{ color: '#b00020' }}>Please enter your email address.</p>}
      {error === 'send' && (
        <p style={{ color: '#b00020' }}>We couldn&apos;t send the link just now. Please try again.</p>
      )}
      {error === 'callback' && (
        <p style={{ color: '#b00020' }}>That sign-in link was invalid or expired. Request a new one.</p>
      )}
      <form action={sendMagicLink}>
        <input type="hidden" name="next" value={next ?? '/schedule'} />
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          style={{ display: 'block', width: '100%', padding: '10px 12px', fontSize: 16, marginBottom: 12 }}
        />
        <button type="submit" style={{ padding: '10px 18px', fontSize: 16, cursor: 'pointer' }}>
          Email me a sign-in link
        </button>
      </form>
    </main>
  );
}
