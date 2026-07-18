import RsvpControl from './RsvpControl';
import type { ScheduleItem } from '@/lib/data/schedule';

function fmt(instant: string | null, tz: string): string {
  if (!instant) return 'Time to be confirmed';
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(
      new Date(instant),
    );
  } catch {
    return new Date(instant).toUTCString();
  }
}

const card = {
  border: '1px solid #e5e5e5',
  borderRadius: 10,
  padding: 16,
  background: '#fff',
} as const;

// Presentational only — receives already-fetched items (see lib/data/schedule.ts) so it can be rendered
// with fixtures for preview, and unit-reasoned about independently of Supabase.
export default function ScheduleView({ items }: { items: ScheduleItem[] }) {
  if (items.length === 0) {
    return (
      <p style={{ color: '#555' }}>
        You don’t have any events on your schedule yet. If you just signed in, your host may still be
        finalizing invitations.
      </p>
    );
  }

  const multiGuest = new Set(items.map((i) => i.guestId)).size > 1;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {items.map((it) => (
        <section key={it.invitationGuestId} style={card}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {it.functionName ?? 'Event'}
            {it.functionType ? <span style={{ fontWeight: 400, color: '#777' }}> · {it.functionType}</span> : null}
          </div>
          {multiGuest && it.guestName ? (
            <div style={{ fontSize: 13, color: '#777' }}>For {it.guestName}</div>
          ) : null}
          <div style={{ marginTop: 4 }}>
            {fmt(it.arrivalInstant, it.tz)} <span style={{ color: '#999' }}>({it.tz})</span>
          </div>
          {it.venueName ? <div style={{ color: '#555', marginTop: 2 }}>{it.venueName}</div> : null}
          <RsvpControl
            invitationGuestId={it.invitationGuestId}
            label={it.functionName ?? 'this event'}
            status={it.rsvpStatus}
            rowVersion={it.rowVersion}
          />
        </section>
      ))}
    </div>
  );
}
