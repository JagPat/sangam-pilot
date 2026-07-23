import { notFound } from 'next/navigation';
import ScheduleView from '../../schedule/ScheduleView';
import RsvpControl from '../../schedule/RsvpControl';
import type { ScheduleItem } from '@/lib/data/schedule';

// DEV-ONLY UI preview with fixture data (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
// Lets us screenshot the real ScheduleView / RsvpControl components without a running Supabase backend.
export const dynamic = 'force-dynamic';

const FIXTURES: ScheduleItem[] = [
  // Fully enriched, bride's side, already accepted — the "declared" card.
  {
    invitationGuestId: 'p1', eventInstanceId: 'i1', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Pithi', functionType: 'pithi', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-10T04:30:00Z', arrivalWallLocal: '2026-12-10T10:00:00', arrivalOffsetMinutes: 330,
    ceremonyInstant: null,
    venueName: 'Patel Residence', venueAddress: '12 Satellite Road, Ahmedabad',
    directionsUrl: 'https://www.google.com/maps/search/?api=1&query=Patel%20Residence%20Ahmedabad',
    dressCode: 'Yellow & floral', muhuratKind: 'instant', muhuratStartInstant: '2026-12-10T05:10:00Z', muhuratEndInstant: null,
    choghadiyaText: 'Amrit Choghadiya', tithiText: 'Margashirsha Shukla Dashami',
    streamUrl: null, familySide: 'bride', cancelled: false,
    performers: [],
    rsvpStatus: 'accepted', rowVersion: 1,
  },
  // Both families, muhurat window, live stream, performers, not yet responded.
  {
    invitationGuestId: 'p2', eventInstanceId: 'i2', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Sangeet Night', functionType: 'sangeet', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-11T13:30:00Z', arrivalWallLocal: '2026-12-11T19:00:00', arrivalOffsetMinutes: 330,
    ceremonyInstant: null,
    venueName: 'The Grand Bhagwati', venueAddress: 'Sindhu Bhavan Road, Ahmedabad',
    directionsUrl: 'https://www.google.com/maps/search/?api=1&query=The%20Grand%20Bhagwati%20Ahmedabad',
    dressCode: 'Festive · Indian formal', muhuratKind: 'window', muhuratStartInstant: '2026-12-11T14:10:00Z', muhuratEndInstant: '2026-12-11T15:30:00Z',
    choghadiyaText: null, tithiText: null,
    streamUrl: 'https://www.youtube.com/live/example', familySide: 'mutual', cancelled: false,
    performers: [
      { name: 'DJ Rehan', role: 'DJ', blurb: 'Bollywood & house · 200+ weddings' },
      { name: 'Dhol Foundation', role: 'Dhol troupe', blurb: 'A five-piece live dhol welcome' },
    ],
    rsvpStatus: null, rowVersion: null,
  },
  // Cross-border: groom's side, New York (EST), black-tie, a live band, tentative.
  {
    invitationGuestId: 'p3', eventInstanceId: 'i3', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Reception', functionType: 'reception', tz: 'America/New_York',
    arrivalInstant: '2026-12-20T23:30:00Z', arrivalWallLocal: '2026-12-20T18:30:00', arrivalOffsetMinutes: -300,
    ceremonyInstant: null,
    venueName: 'The Plaza', venueAddress: '768 5th Avenue, New York',
    directionsUrl: 'https://www.google.com/maps/search/?api=1&query=The%20Plaza%20New%20York',
    dressCode: 'Black-tie', muhuratKind: null, muhuratStartInstant: null, muhuratEndInstant: null,
    choghadiyaText: null, tithiText: null,
    streamUrl: null, familySide: 'groom', cancelled: false,
    performers: [{ name: 'The Manhattan Quartet', role: 'Live band', blurb: 'Jazz & standards' }],
    rsvpStatus: 'tentative', rowVersion: 2,
  },
  // Un-enriched fallback: no venue, no dress/muhurat yet — still a calm, complete card.
  {
    invitationGuestId: 'p4', eventInstanceId: 'i4', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Mehndi', functionType: 'mehndi', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-09T09:00:00Z', arrivalWallLocal: '2026-12-09T14:30:00', arrivalOffsetMinutes: 330,
    ceremonyInstant: null,
    venueName: null, venueAddress: null, directionsUrl: null,
    dressCode: null, muhuratKind: null, muhuratStartInstant: null, muhuratEndInstant: null,
    choghadiyaText: null, tithiText: null,
    streamUrl: null, familySide: null, cancelled: false,
    performers: [],
    rsvpStatus: null, rowVersion: null,
  },
  // Cancelled — essentials stay visible, no RSVP control.
  {
    invitationGuestId: 'p5', eventInstanceId: 'i5', guestId: 'g1', guestName: 'Jaya Patel',
    functionName: 'Garba', functionType: 'garba', tz: 'Asia/Kolkata',
    arrivalInstant: '2026-12-11T15:00:00Z', arrivalWallLocal: '2026-12-11T20:30:00', arrivalOffsetMinutes: 330,
    ceremonyInstant: null,
    venueName: 'Community Grounds', venueAddress: 'Bodakdev, Ahmedabad',
    directionsUrl: 'https://www.google.com/maps/search/?api=1&query=Bodakdev%20Ahmedabad',
    dressCode: 'Traditional', muhuratKind: null, muhuratStartInstant: null, muhuratEndInstant: null,
    choghadiyaText: null, tithiText: null,
    streamUrl: null, familySide: 'bride', cancelled: true,
    performers: [],
    rsvpStatus: null, rowVersion: null,
  },
];

export default function PreviewSchedule() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();

  return (
    <main className="sg-guest">
      <div className="sg-shell">
        <div className="sg-topbar">
          <span className="sg-brand">Sangam</span>
          <form action="#" method="post">
            <button type="submit" className="sg-signout">Sign out</button>
          </form>
        </div>

        <header className="sg-hero">
          <div className="sg-eyebrow">Your invitation</div>
          <h1>Your schedule</h1>
          <p>jaya@example.com · preview (fixture data)</p>
        </header>

        <div className="sg-ornament">
          <span />
          <b>✦</b>
          <span />
        </div>

        <ScheduleView items={FIXTURES} />

        <div className="sg-ornament" style={{ marginTop: 40 }}>
          <span />
          <b>RSVP · confirm step</b>
          <span />
        </div>
        <article className="sg-card sg-card--event">
          <div className="sg-card__topline is-bride" />
          <div className="sg-card__body">
            <div className="sg-card__tag">sangeet</div>
            <h2 className="sg-card__name" style={{ marginBottom: 0 }}>Sangeet Night</h2>
            <RsvpControl invitationGuestId="preview" label="Sangeet Night" status={null} rowVersion={null} initialEcho="accepted" />
          </div>
        </article>

        <div className="sg-foot">Sangam · two families, one celebration</div>
      </div>
    </main>
  );
}
