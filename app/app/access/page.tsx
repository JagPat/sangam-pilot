import { requireVerifiedUser } from '@/lib/auth/session';
import { retryAccountSetup } from './actions';

export const dynamic = 'force-dynamic';

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireVerifiedUser('/access');
  const { next } = await searchParams;

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
            <input type="hidden" name="next" value={next ?? ''} />
            <button className="sg-btn sg-btn--primary sg-btn--block" type="submit">Retry account setup</button>
          </form>
        </div>
      </div>
    </main>
  );
}
