import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 24, maxWidth: 640, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1>Sangam</h1>
      <p>Your wedding companion — your personalized schedule and RSVPs, in one place.</p>
      <p>
        <Link href="/login">Sign in</Link> with the email your invitation was sent to, then head to{' '}
        <Link href="/schedule">your schedule</Link>.
      </p>
    </main>
  );
}
