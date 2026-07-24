import { notFound } from 'next/navigation';
import { FamilyEventsWeddingView } from '../../host/events/FamilyEventsView';
import { HostNavView } from '../../host/HostNav';
import type { FamilyEventsWedding } from '@/lib/data/family-events';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FAMILY_SECTIONS = [
  { href: '/host/manage', label: 'Guests', key: 'manage' },
  { href: '/host/events', label: 'Events', key: 'events' },
  { href: '/host/stay-overview', label: 'Stay & travel', key: 'stay-overview' },
];

const FIX: FamilyEventsWedding = {
  weddingId: 'w1', title: 'Patel · Shah', defaultTimezone: 'Asia/Kolkata',
  adminGroupId: 'bg1', adminGroupName: 'Shah family (bride)',
  venues: [
    { id: 'v1', name: 'The Grand Bhagwati', tz: 'Asia/Kolkata' },
    { id: 'v2', name: 'Riverside Lawn', tz: 'Asia/Kolkata' },
  ],
  events: [
    { eventInstanceId: 'e1', functionName: 'Mehndi', functionType: 'mehndi', venueId: 'v2', venueName: 'Riverside Lawn', whenInstant: '2026-08-13T12:30:00Z', wallLocal: '2026-08-13 18:00:00', tz: 'Asia/Kolkata', cancelled: false, dressCode: 'Festive Indian', muhuratWall: null, tithiText: null, choghadiyaText: null, streamUrl: null, mine: true, hostNames: ['Shah family (bride)'] },
    { eventInstanceId: 'e2', functionName: 'Sangeet', functionType: 'sangeet', venueId: 'v1', venueName: 'The Grand Bhagwati', whenInstant: '2026-08-13T15:00:00Z', wallLocal: '2026-08-13 20:30:00', tz: 'Asia/Kolkata', cancelled: false, dressCode: 'Indo-western', muhuratWall: null, tithiText: null, choghadiyaText: null, streamUrl: null, mine: true, hostNames: ['Shah family (bride)'] },
    { eventInstanceId: 'e3', functionName: 'Baraat', functionType: 'baraat', venueId: 'v1', venueName: 'The Grand Bhagwati', whenInstant: '2026-08-14T11:30:00Z', wallLocal: '2026-08-14 17:00:00', tz: 'Asia/Kolkata', cancelled: false, dressCode: null, muhuratWall: null, tithiText: null, choghadiyaText: null, streamUrl: null, mine: false, hostNames: ['Patel family (groom)'] },
  ],
};

export default function PreviewFamilyEvents() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();
  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNavView current="events" email="bride.admin@example.com" roleLabel="Family admin" sections={FAMILY_SECTIONS} />
        <FamilyEventsWeddingView w={FIX} />
      </div>
    </main>
  );
}
