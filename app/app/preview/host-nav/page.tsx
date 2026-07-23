import { notFound } from 'next/navigation';
import { HostNavView } from '../../host/HostNav';
import { OWNER_SECTIONS } from '@/lib/data/nav';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

export default function PreviewHostNav() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();

  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNavView current="setup" email="jagrutpatel@gmail.com" roleLabel="Event manager" sections={OWNER_SECTIONS} />

        <div className="sg-pagehead">
          <h1>Venues &amp; events</h1>
          <p>
            The bar above is the new role-aware console menu — clear tabs, the current section highlighted,
            and who you’re signed in as. This is the screen where you add, edit, and cancel events.
          </p>
        </div>

        <section className="sg-section">
          <h2>Add an event</h2>
          <p className="sg-muted">(event form renders here in the real screen)</p>
        </section>
      </div>
    </main>
  );
}
