import { notFound } from 'next/navigation';
import ScheduleView from '../../schedule/ScheduleView';
import RsvpControl from '../../schedule/RsvpControl';
import type { ScheduleItem } from '@/lib/data/schedule';

// DEV-ONLY UI preview with fixture data (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
// Lets us screenshot the real ScheduleView / RsvpControl components without a running Supabase backend.
export const dynamic = 'force-dynamic';

const wrap = { padding: 24, maxWidth: 640, margin: '0 auto', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 } as const;

const FIXTURES: ScheduleItem[] = [
  {
    invitationGuestId: 'p1', eventInstanceId: 'i1', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Pithi', functionType: 'pithi', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-10T04:30:00Z', arrivalWallLocal: '2026-12-10T10:00:00', arrivalOffsetMinutes: 330,
    venueName: 'Patel Residence, Ahmedabad', rsvpStatus: 'accepted', rowVersion: 1,
  },
  {
    invitationGuestId: 'p2', eventInstanceId: 'i2', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Sangeet', functionType: 'sangeet', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-11T13:30:00Z', arrivalWallLocal: '2026-12-11T19:00:00', arrivalOffsetMinutes: 330,
    venueName: 'The Grand Bhagwati', rsvpStatus: null, rowVersion: null,
  },
  {
    invitationGuestId: 'p3', eventInstanceId: 'i3', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Wedding Ceremony', functionType: 'ceremony', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-12T03:00:00Z', arrivalWallLocal: '2026-12-12T08:30:00', arrivalOffsetMinutes: 330,
    venueName: 'Riverfront Lawns', rsvpStatus: 'tentative', rowVersion: 2,
  },
];

export default function PreviewSchedule() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();

  return (
    <main style={wrap}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Your schedule</h1>
        <div style={{ fontSize: 13, color: '#777' }}>jaya@example.com · preview (fixture data)</div>
      </header>

      <ScheduleView items={FIXTURES} />

      <h2 style={{ marginTop: 28, fontSize: 15 }}>RSVP — confirm step (preview)</h2>
      <section style={{ border: '1px solid #e5e5e5', borderRadius: 10, padding: 16, background: '#fff' }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Sangeet <span style={{ fontWeight: 400, color: '#777' }}>· sangeet</span></div>
        <div style={{ marginTop: 4 }}>Friday, December 11, 2026 at 7:00 PM <span style={{ color: '#999' }}>(Asia/Kolkata)</span></div>
        <RsvpControl invitationGuestId="preview" label="Sangeet" status={null} rowVersion={null} initialEcho="accepted" />
      </section>
    </main>
  );
}
