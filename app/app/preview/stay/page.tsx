import { notFound } from 'next/navigation';
import { StayWeddingView } from '../../host/stay/StayView';
import { ServicesConsoleView } from '../../host/stay/ServicesConsole';
import { HostNavView } from '../../host/HostNav';
import { OWNER_SECTIONS } from '@/lib/data/nav';
import type { StayWedding } from '@/lib/data/stay';
import type { ConsoleServicesWedding } from '@/lib/data/services';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FIX: StayWedding = {
  weddingId: 'w1', title: 'Patel · Shah',
  hotels: [{ id: 'h1', name: 'The Grand Bhagwati' }],
  totals: { rooms: 150, occupied: 96, free: 54, pickups: 2, waiting: 2 },
  summary: [
    { roomType: 'double', total: 90, occupied: 60, free: 30 },
    { roomType: 'triple', total: 40, occupied: 28, free: 12 },
    { roomType: 'suite', total: 20, occupied: 8, free: 12 },
  ],
  households: [
    { id: 'hh1', name: 'Shah Household', allocated: true, guests: [{ guestId: 'g1', guestName: 'Priya Shah' }, { guestId: 'g2', guestName: 'Nikhil Shah' }, { guestId: 'g3', guestName: 'Aarav Shah' }] },
    { id: 'hh2', name: 'Mehta Household', allocated: false, guests: [{ guestId: 'g4', guestName: 'Anaya Mehta' }, { guestId: 'g5', guestName: 'Rohan Mehta' }] },
    { id: 'hh3', name: 'Iyer Household', allocated: false, guests: [{ guestId: 'g6', guestName: 'Meera Iyer' }] },
  ],
  waitlist: [
    { householdId: 'hh2', householdName: 'Mehta Household', guestCount: 2, status: 'needs_room', nights: 2, arriveOn: '2026-08-13', departOn: '2026-08-15', preferredType: 'double', notes: 'High floor if possible' },
    { householdId: 'hh3', householdName: 'Iyer Household', guestCount: 1, status: 'waitlisted', nights: 1, arriveOn: '2026-08-14', departOn: '2026-08-15', preferredType: 'single', notes: null },
  ],
  arrivals: [
    { guestId: 'g1', guestName: 'Priya Shah', householdName: 'Shah Household', direction: 'arrival', mode: 'flight', atInstant: '2026-08-13T14:30:00+00:00', carrier: 'IndiGo', number: '6E-203', fromPlace: 'Mumbai (BOM)', arrangedBy: 'host', needsPickup: true, pickupStatus: 'requested', luggageNote: '2 large suitcases' },
    { guestId: 'g4', guestName: 'Anaya Mehta', householdName: 'Mehta Household', direction: 'arrival', mode: 'train', atInstant: '2026-08-13T09:10:00+00:00', carrier: 'Rajdhani', number: '12951', fromPlace: 'Delhi', arrangedBy: 'host', needsPickup: true, pickupStatus: 'assigned', luggageNote: null },
    { guestId: 'g2', guestName: 'Nikhil Shah', householdName: 'Shah Household', direction: 'departure', mode: 'flight', atInstant: '2026-08-15T18:00:00+00:00', carrier: 'IndiGo', number: '6E-540', fromPlace: null, arrangedBy: 'self', needsPickup: false, pickupStatus: 'none', luggageNote: null },
  ],
  rooms: [
    {
      roomId: 'r1', label: '201', roomType: 'triple', capacity: 3, hotelId: 'h1', hotelName: 'The Grand Bhagwati', outOfService: false,
      allocation: { allocationId: 'a1', householdId: 'hh1', householdName: 'Shah Household', status: 'confirmed', checkIn: '2026-08-13', checkOut: '2026-08-15', occupants: [{ guestId: 'g1', guestName: 'Priya Shah' }, { guestId: 'g2', guestName: 'Nikhil Shah' }] },
    },
    { roomId: 'r2', label: '202', roomType: 'double', capacity: 2, hotelId: 'h1', hotelName: 'The Grand Bhagwati', outOfService: false, allocation: null },
    { roomId: 'r3', label: '203', roomType: 'suite', capacity: 4, hotelId: 'h1', hotelName: 'The Grand Bhagwati', outOfService: true, allocation: null },
  ],
};

const SVC_FIX: ConsoleServicesWedding = {
  weddingId: 'w1', title: 'Patel · Shah',
  services: [
    { id: 's1', name: 'Welcome hamper', description: 'Sweets & travel essentials', category: null, billing: 'included', priceCents: 45000, currency: 'INR', unitLabel: 'per room', includedQty: null, scope: 'per_household', settleHint: 'front_desk', active: true, requestCount: 12 },
    { id: 's2', name: 'Airport pickup', description: 'Shared coach from the airport', category: 'transport', billing: 'allowance', priceCents: 150000, currency: 'INR', unitLabel: 'per car', includedQty: 1, scope: 'per_household', settleHint: 'front_desk', active: true, requestCount: 6 },
    { id: 's3', name: 'Spa treatment', description: '60-min signature massage', category: 'wellness', billing: 'guest_paid', priceCents: 250000, currency: 'INR', unitLabel: 'per treatment', includedQty: null, scope: 'per_person', settleHint: 'hotel_folio', active: true, requestCount: 3 },
  ],
  queue: [
    { id: 'r2', serviceName: 'Spa treatment', billing: 'guest_paid', scope: 'per_person', who: 'Priya Shah', guestId: 'g1', householdId: 'hh1', qty: 2, status: 'requested', settle: 'due', notes: 'Prefer an evening slot', chargeCents: 500000, currency: 'INR', settleHint: 'hotel_folio' },
    { id: 'r3', serviceName: 'Airport pickup', billing: 'allowance', scope: 'per_household', who: 'Mehta Household', guestId: null, householdId: 'hh2', qty: 2, status: 'confirmed', settle: 'due', notes: null, chargeCents: 150000, currency: 'INR', settleHint: 'front_desk' },
    { id: 'r1', serviceName: 'Welcome hamper', billing: 'included', scope: 'per_household', who: 'Shah Household', guestId: null, householdId: 'hh1', qty: 1, status: 'delivered', settle: 'none', notes: null, chargeCents: 0, currency: 'INR', settleHint: 'front_desk' },
  ],
  totals: { hostCostCents: 540000, guestChargesCents: 650000, outstanding: 2, currency: 'INR' },
};

export default function PreviewStay() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();
  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNavView current="stay" email="jagrutpatel@gmail.com" roleLabel="Event manager" sections={OWNER_SECTIONS} />
        <StayWeddingView w={FIX} />
        <ServicesConsoleView s={SVC_FIX} />
      </div>
    </main>
  );
}
