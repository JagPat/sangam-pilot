import { notFound } from 'next/navigation';
import { StayWeddingView } from '../../host/stay/StayView';
import { HostNavView } from '../../host/HostNav';
import { OWNER_SECTIONS } from '@/lib/data/nav';
import type { StayWedding } from '@/lib/data/stay';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FIX: StayWedding = {
  weddingId: 'w1', title: 'Patel · Shah',
  hotels: [{ id: 'h1', name: 'The Grand Bhagwati' }],
  totals: { rooms: 150, occupied: 96, free: 54 },
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
  rooms: [
    {
      roomId: 'r1', label: '201', roomType: 'triple', capacity: 3, hotelId: 'h1', hotelName: 'The Grand Bhagwati', outOfService: false,
      allocation: { allocationId: 'a1', householdId: 'hh1', householdName: 'Shah Household', status: 'confirmed', checkIn: '2026-08-13', checkOut: '2026-08-15', occupants: [{ guestId: 'g1', guestName: 'Priya Shah' }, { guestId: 'g2', guestName: 'Nikhil Shah' }] },
    },
    { roomId: 'r2', label: '202', roomType: 'double', capacity: 2, hotelId: 'h1', hotelName: 'The Grand Bhagwati', outOfService: false, allocation: null },
    { roomId: 'r3', label: '203', roomType: 'suite', capacity: 4, hotelId: 'h1', hotelName: 'The Grand Bhagwati', outOfService: true, allocation: null },
  ],
};

export default function PreviewStay() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();
  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNavView current="stay" email="jagrutpatel@gmail.com" roleLabel="Event manager" sections={OWNER_SECTIONS} />
        <StayWeddingView w={FIX} />
      </div>
    </main>
  );
}
