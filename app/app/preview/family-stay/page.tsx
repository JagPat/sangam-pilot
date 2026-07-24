import { notFound } from 'next/navigation';
import { FamilyStayView } from '../../host/stay-overview/FamilyStayView';
import { HostNavView } from '../../host/HostNav';
import type { FamilyStayOverview } from '@/lib/data/family-stay';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FAMILY_SECTIONS = [
  { href: '/host/manage', label: 'Guests', key: 'manage' },
  { href: '/host/stay-overview', label: 'Stay & travel', key: 'stay-overview' },
];

const FIX: FamilyStayOverview = {
  weddingId: 'w1', title: 'Patel · Shah',
  activity: [
    { action: 'service_settled', summary: 'Service request settled', who: 'Priya Shah', when: '2026-07-21T14:30:00+00:00' },
    { action: 'pickup', summary: 'Pickup assigned (arrival)', who: 'Priya Shah', when: '2026-07-20T10:02:00+00:00' },
    { action: 'room_allocated', summary: 'Allocated a room to a household', who: 'Shah Household', when: '2026-07-20T09:15:00+00:00' },
    { action: 'stay_request', summary: 'Room request: needs_room', who: 'Iyer Household', when: '2026-07-19T08:00:00+00:00' },
  ],
  households: [
    {
      householdId: 'hh1', householdName: 'Shah Household',
      rooms: [{ label: '201', roomType: 'triple', hotelName: 'The Grand Bhagwati', status: 'confirmed', occupants: ['Nikhil Shah', 'Priya Shah'] }],
      request: { status: 'allocated', nights: 2, arriveOn: '2026-08-13', departOn: '2026-08-15', notes: 'Ground floor preferred' },
      guests: [
        { guestId: 'g1', guestName: 'Priya Shah', arrival: { mode: 'flight', atInstant: '2026-08-13T14:30:00+00:00', carrier: 'IndiGo', number: '6E-203', fromPlace: 'Mumbai (BOM)', needsPickup: true, pickupStatus: 'assigned' }, departure: null },
        { guestId: 'g2', guestName: 'Nikhil Shah', arrival: null, departure: null },
      ],
      services: [
        { name: 'Spa treatment', billing: 'guest_paid', who: 'Priya Shah', qty: 2, status: 'requested', settle: 'due', chargeLabel: '₹5,000' },
        { name: 'Welcome hamper', billing: 'included', who: null, qty: 1, status: 'delivered', settle: 'none', chargeLabel: null },
      ],
    },
    {
      householdId: 'hh2', householdName: 'Iyer Household',
      rooms: [],
      request: { status: 'needs_room', nights: 1, arriveOn: '2026-08-14', departOn: '2026-08-15', notes: null },
      guests: [{ guestId: 'g3', guestName: 'Meera Iyer', arrival: null, departure: null }],
      services: [],
    },
  ],
};

export default function PreviewFamilyStay() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();
  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNavView current="stay-overview" email="bride.admin@example.com" roleLabel="Family admin" sections={FAMILY_SECTIONS} />
        <FamilyStayView o={FIX} />
      </div>
    </main>
  );
}
