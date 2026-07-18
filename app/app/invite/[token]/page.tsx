// Invite landing — STEP 1 of the two-step exchange (GET, non-consuming).
//
// This page ONLY validates the token and shows a confirmation. It NEVER binds an account: a prefetch, a
// link scanner, a retry, or a shared device opening the URL must not consume the single-use link (that
// happens only on the CSRF-protected POST in ./actions.ts).
//
// PRIVACY: the guest's name is PII. An UNAUTHENTICATED visitor (scanner, unfurl/preview bot) gets only a
// validity check (peekInvite → no name). The name (peekInviteDetails) is shown ONLY in the signed-in
// branch AND only when the session's verified contact matches the invited recipient — so a forwarded link
// opened by a DIFFERENT authenticated account still sees no name (and cannot redeem in ./actions.ts).
//
// The whole route is gated by INVITE_EXCHANGE_ENABLED so it stays dark until the session-mint step is
// wired up and the DB has been certified against Supabase-local.

import { notFound } from 'next/navigation';
import { peekInvite, peekInviteDetails } from '@/lib/auth/accessLink';
import { getVerifiedUser } from '@/lib/auth/session';
import { confirmInvite } from './actions';

export const dynamic = 'force-dynamic'; // per-request: reads cookies + the token; never cache.

const wrap = { padding: 24, maxWidth: 560, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 } as const;

function Invalid() {
  return (
    <main style={wrap}>
      <h1>Invite link</h1>
      <p>This invite link is invalid or has already been used. Please ask your host to send a new one.</p>
    </main>
  );
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  if (process.env.INVITE_EXCHANGE_ENABLED !== '1') notFound();

  const { token } = await params;
  const { error } = await searchParams;
  const user = await getVerifiedUser();

  // ---- UNAUTHENTICATED: validity only, NO guest name is fetched or rendered. ----
  if (!user) {
    const basic = await peekInvite(token); // returns { weddingId, valid } — never PII
    if (!basic.valid) return <Invalid />;
    return (
      <main style={wrap}>
        <h1>You&apos;re invited</h1>
        <p>Please sign in to view your invitation and accept. (Sign-in is the remaining integration step.)</p>
      </main>
    );
  }

  // ---- SIGNED IN: reveal the guest name ONLY to the intended recipient (verified-contact match). ----
  const info = await peekInviteDetails(token, user.email ?? ''); // name only if the contact matches
  if (!info) {
    // Null = invalid/used link OR a live link that isn't for this account's contact. Tell them apart with
    // the no-PII validity check (both messages are safe to show an authenticated user).
    const basic = await peekInvite(token);
    if (basic.valid) {
      return (
        <main style={wrap}>
          <h1>Invite link</h1>
          <p>
            This invitation was sent to a different contact. Please sign in with the email or phone your
            invite was sent to, then reopen this link.
          </p>
        </main>
      );
    }
    return <Invalid />;
  }

  return (
    <main style={wrap}>
      <h1>You&apos;re invited</h1>
      {error === 'redeem' && (
        <p style={{ color: '#b00020' }}>
          That link couldn&apos;t be redeemed — it may have just been used on another device. Try again,
          or ask your host for a new link.
        </p>
      )}
      <p>
        This link is for <strong>{info.guestName ?? 'a guest'}</strong>.
      </p>
      <p>
        You&apos;re signed in as <strong>{user.email ?? user.id}</strong>. Confirming will link{' '}
        <strong>this account</strong> to the invitation. Nothing has been linked yet.
      </p>
      {/* POST -> server action: CSRF/origin-protected by Next. The account is re-read from the verified
          session at POST time; the token (below) is the sole wedding/guest authority. */}
      <form action={confirmInvite}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" style={{ padding: '10px 18px', fontSize: 16, cursor: 'pointer' }}>
          Confirm &amp; continue
        </button>
      </form>
    </main>
  );
}
