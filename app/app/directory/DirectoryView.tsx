import type { DirectoryEntry } from '@/lib/data/directory';

// Presentational only — receives already-fetched, consent-filtered entries (see lib/data/directory.ts),
// so it can be rendered with fixtures for preview and reasoned about independently of Supabase.

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
}

const SIDE_LABEL: Record<string, string> = { bride: "Bride's side", groom: "Groom's side", mutual: 'Both families' };

function DirectoryCard({ e }: { e: DirectoryEntry }) {
  const sub = [e.relationship, e.side ? SIDE_LABEL[e.side] ?? null : null].filter(Boolean).join(' · ');
  return (
    <div className="sg-dircard">
      <span className={`sg-dir__avatar${e.side ? ` is-${e.side}` : ''}`}>{initials(e.fullName ?? '·')}</span>
      <div>
        <div className="sg-dir__name">{e.fullName ?? '—'}</div>
        {sub ? <div className="sg-dir__sub">{sub}</div> : null}
      </div>
    </div>
  );
}

export default function DirectoryView({ entries }: { entries: DirectoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="sg-empty">
        <div className="sg-empty__title">No one to show yet</div>
        <p style={{ margin: 0 }}>
          The directory fills in as guests choose to be listed. If you’d rather not appear, ask your host to
          remove you.
        </p>
      </div>
    );
  }
  return (
    <div className="sg-dirgrid">
      {entries.map((e) => (
        <DirectoryCard key={e.guestId} e={e} />
      ))}
    </div>
  );
}
