import { notFound } from 'next/navigation';
import DirectoryView from '../../directory/DirectoryView';
import { GuestTopbar } from '../../GuestTopbar';
import type { DirectoryEntry } from '@/lib/data/directory';

// DEV-ONLY UI preview with fixture data (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FIXTURES: DirectoryEntry[] = [
  { weddingId: 'w1', guestId: 'g1', fullName: 'Anaya Mehta', relationship: "Bride's cousin", side: 'bride' },
  { weddingId: 'w1', guestId: 'g2', fullName: 'Rohan Kapoor', relationship: "Groom's college friend", side: 'groom' },
  { weddingId: 'w1', guestId: 'g3', fullName: 'Priya & Nikhil Shah', relationship: 'Family friends', side: 'mutual' },
  { weddingId: 'w1', guestId: 'g4', fullName: 'Dr. Suresh Patel', relationship: null, side: 'bride' },
  { weddingId: 'w1', guestId: 'g5', fullName: 'Meera Iyer', relationship: null, side: null },
  { weddingId: 'w1', guestId: 'g6', fullName: 'James Whitfield', relationship: "Groom's colleague", side: 'groom' },
];

export default function PreviewDirectory() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();

  return (
    <main className="sg-guest">
      <div className="sg-shell">
        <GuestTopbar current="directory" />

        <header className="sg-hero">
          <div className="sg-eyebrow">Who’s coming</div>
          <h1>Guest directory</h1>
          <p>The people you’ll be celebrating with. Only names are shown — never contact details.</p>
        </header>

        <div className="sg-ornament">
          <span />
          <b>✦</b>
          <span />
        </div>

        <DirectoryView entries={FIXTURES} />

        <div className="sg-foot">Sangam · two families, one celebration</div>
      </div>
    </main>
  );
}
