import { notFound } from 'next/navigation';
import { MyStayView } from '../../stay/MyStayView';
import { MyServicesView } from '../../stay/MyServicesView';
import { GuestTopbarView } from '../../GuestTopbar';
import type { MyStayData } from '@/lib/data/mystay';
import type { GuestServicesData } from '@/lib/data/services';

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

const SVC_FIX: GuestServicesData = {
  households: [{ householdId: 'hh1', householdName: 'Shah Household', guests: [{ guestId: 'g1', guestName: 'Priya' }, { guestId: 'g2', guestName: 'Nikhil' }] }],
  included: [
    { id: 's1', weddingId: 'w1', name: 'Welcome hamper', description: 'Sweets & travel essentials waiting in your room', category: null, billing: 'included', priceCents: 0, currency: 'INR', unitLabel: null, includedQty: null, scope: 'per_household', settleHint: 'front_desk', bookings: [{ id: 'r1', guestId: null, householdId: 'hh1', qty: 1, status: 'confirmed', settle: 'none', notes: null, chargeCents: 0 }] },
    { id: 's2', weddingId: 'w1', name: 'Airport pickup', description: 'Shared coach from the airport', category: 'transport', billing: 'allowance', priceCents: 150000, currency: 'INR', unitLabel: 'per car', includedQty: 1, scope: 'per_household', settleHint: 'front_desk', bookings: [] },
  ],
  paid: [
    { id: 's3', weddingId: 'w1', name: 'Spa treatment', description: '60-minute signature massage at the hotel spa', category: 'wellness', billing: 'guest_paid', priceCents: 250000, currency: 'INR', unitLabel: 'per treatment', includedQty: null, scope: 'per_person', settleHint: 'hotel_folio', bookings: [{ id: 'r2', guestId: 'g1', householdId: 'hh1', qty: 2, status: 'requested', settle: 'due', notes: null, chargeCents: 500000 }] },
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
        <MyServicesView data={SVC_FIX} />
        <div className="sg-foot">Sangam · two families, one celebration</div>
      </div>
    </main>
  );
}
