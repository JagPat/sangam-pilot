import { notFound } from 'next/navigation';
import { MyStayView } from '../../stay/MyStayView';
import { GuestTopbarView } from '../../GuestTopbar';
import type { MyStayData } from '@/lib/data/mystay';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FIX: MyStayData = {
  rooms: [
    { roomLabel: '201', roomType: 'triple', hotelName: 'The Grand Bhagwati', checkIn: '2026-08-13', checkOut: '2026-08-15', status: 'confirmed', roommates: ['Priya Shah', 'Nikhil Shah'] },
  ],
  households: [
    {
      weddingId: 'w1', householdId: 'hh1', householdName: 'Shah Household',
      request: { status: 'allocated', nights: 2, arriveOn: '2026-08-13', departOn: '2026-08-15', notes: 'Ground floor preferred — travelling with elderly parents' },
      guests: [
        {
          guestId: 'g1', guestName: 'Priya',
          arrival: { mode: 'flight', atInstant: '2026-08-13T14:30:00+00:00', carrier: 'IndiGo', number: '6E-203', fromPlace: 'Mumbai (BOM)', arrangedBy: 'host', needsPickup: true, pickupStatus: 'assigned', luggageNote: '2 large suitcases' },
          departure: { mode: 'flight', atInstant: '2026-08-15T18:00:00+00:00', carrier: 'IndiGo', number: '6E-540', fromPlace: null, arrangedBy: 'self', needsPickup: false, pickupStatus: 'none', luggageNote: null },
        },
        {
          guestId: 'g2', guestName: 'Nikhil',
          arrival: null,
          departure: null,
        },
      ],
    },
  ],
};

export default function PreviewMyStay() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();
  return (
    <main className="sg-guest">
      <div className="sg-shell">
        <GuestTopbarView current="stay" showConsole={false} />
        <header className="sg-hero">
          <div className="sg-eyebrow">Stay &amp; travel</div>
          <h1>Your stay</h1>
          <p>priya@example.com</p>
        </header>
        <div className="sg-ornament"><span /><b>✦</b><span /></div>
        <MyStayView data={FIX} />
        <div className="sg-foot">Sangam · two families, one celebration</div>
      </div>
    </main>
  );
}
