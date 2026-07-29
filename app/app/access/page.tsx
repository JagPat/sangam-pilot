import { requireVerifiedUser } from '@/lib/auth/session';
import { safeInternalPath, withSafeNext } from '@/lib/auth/landing';
import { retryAccountSetup } from './actions';

export const dynamic = 'force-dynamic';

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: requestedNext } = await searchParams;
  const safeNext = requestedNext ? safeInternalPath(requestedNext, '/schedule') : null;
  await requireVerifiedUser(safeNext ? withSafeNext('/access', safeNext) : '/access');

  return (
    <main className="sg-guest">
      <div className="sg-shell" style={{ maxWidth: 520 }}>
        <header className="sg-hero">
          <div className="sg-eyebrow">Account setup</div>
          <h1>Your sign-in worked</h1>
          <p>Sangam could not finish connecting this verified account to its wedding access.</p>
        </header>
        <div className="sg-card">
          <div className="sg-banner is-err">
            No wedding information has been exposed. Retry the secure account setup below.
          </div>
          <form action={retryAccountSetup}>
            <input type="hidden" name="next" value={safeNext ?? ''} />
            <button className="sg-btn sg-btn--primary sg-btn--block" type="submit">Retry account setup</button>
          </form>
        </div>
      </div>
    </main>
  );
}
