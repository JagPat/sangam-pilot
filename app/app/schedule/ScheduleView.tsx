import RsvpControl from './RsvpControl';
import type { ScheduleItem, FamilySide } from '@/lib/data/schedule';

// Presentational only — receives already-fetched items (see lib/data/schedule.ts) so it can be rendered
// with fixtures for preview, and reasoned about independently of Supabase.

// Warmer labels for the zones this wedding actually spans; falls back to the Intl short name elsewhere.
const FRIENDLY_TZ: Record<string, string> = { 'Asia/Kolkata': 'IST' };

function zparts(instant: string, tz: string): { date: string; time: string; tzShort: string } {
  const d = new Date(instant);
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
  let tzShort = '';
  try {
    tzShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    /* tz label is best-effort */
  }
  return { date, time, tzShort: FRIENDLY_TZ[tz] ?? tzShort };
}

function timeOnly(instant: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(instant));
}

const FAM_LABEL: Record<FamilySide, string> = { bride: "Bride's side", groom: "Groom's side", mutual: 'Both families' };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
}

const Icon = {
  cal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  dress: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  ),
};

function EventCard({ it, multiGuest }: { it: ScheduleItem; multiGuest: boolean }) {
  const when = it.arrivalInstant ? zparts(it.arrivalInstant, it.tz) : null;
  const muhurat =
    it.muhuratStartInstant
      ? it.muhuratKind === 'window' && it.muhuratEndInstant
        ? `${timeOnly(it.muhuratStartInstant, it.tz)}–${timeOnly(it.muhuratEndInstant, it.tz)}`
        : timeOnly(it.muhuratStartInstant, it.tz)
      : null;

  return (
    <article className="sg-card sg-card--event">
      <div className={`sg-card__topline${it.familySide ? ` is-${it.familySide}` : ''}`} />

      {it.venueName ? (
        <div className="sg-card__hero">
          <span className="sg-card__herolabel">Venue</span>
          <span className="sg-card__heroname">{it.venueName}</span>
        </div>
      ) : null}

      <div className="sg-card__body">
        {it.functionType ? <div className="sg-card__tag">{it.functionType}</div> : null}
        <div className="sg-card__namerow">
          <h2 className="sg-card__name">{it.functionName ?? 'Event'}</h2>
          {it.familySide ? <span className={`sg-fam is-${it.familySide}`}>{FAM_LABEL[it.familySide]}</span> : null}
        </div>
        {multiGuest && it.guestName ? <div className="sg-card__for">For {it.guestName}</div> : null}

        {it.cancelled ? <div className="sg-cancel">This event has been cancelled</div> : null}

        <div className="sg-meta">
          <span className="sg-meta__icon">{Icon.cal}</span>
          <div>
            <div className="sg-meta__date">{when ? when.date : 'Time to be confirmed'}</div>
            {when ? (
              <div className="sg-meta__sub">
                {when.time}
                {when.tzShort ? ` · ${when.tzShort}` : ''}
              </div>
            ) : null}
          </div>
        </div>

        {it.venueName ? (
          <div className="sg-meta">
            <span className="sg-meta__icon">{Icon.pin}</span>
            <div>
              <div className="sg-meta__date" style={{ fontWeight: 500 }}>{it.venueName}</div>
              {it.venueAddress ? <div className="sg-meta__sub">{it.venueAddress}</div> : null}
              {it.directionsUrl ? (
                <a className="sg-getdir" href={it.directionsUrl} target="_blank" rel="noopener noreferrer">
                  Get directions →
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        {it.dressCode || muhurat ? (
          <div className="sg-chips">
            {it.dressCode ? (
              <span className="sg-chip">{Icon.dress}{it.dressCode}</span>
            ) : null}
            {muhurat ? (
              <span className="sg-chip">{Icon.clock}Muhurat {muhurat}</span>
            ) : null}
          </div>
        ) : null}

        {it.tithiText || it.choghadiyaText ? (
          <div className="sg-auspic">
            {it.tithiText ? <span>{it.tithiText}</span> : null}
            {it.choghadiyaText ? <span>{it.choghadiyaText}</span> : null}
          </div>
        ) : null}

        {it.performers.length ? (
          <div className="sg-perf">
            <div className="sg-perf__head">Performing</div>
            {it.performers.map((p, idx) => (
              <div className="sg-perf__row" key={idx}>
                <span className="sg-perf__avatar">{initials(p.name)}</span>
                <div>
                  <div className="sg-perf__name">{p.name}{p.role ? <span className="sg-perf__role"> · {p.role}</span> : null}</div>
                  {p.blurb ? <div className="sg-perf__blurb">{p.blurb}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {it.streamUrl ? (
          <div>
            <a className="sg-stream" href={it.streamUrl} target="_blank" rel="noopener noreferrer">
              {Icon.video} Watch the live stream →
            </a>
          </div>
        ) : null}

        {!it.cancelled ? (
          <RsvpControl
            invitationGuestId={it.invitationGuestId}
            label={it.functionName ?? 'this event'}
            status={it.rsvpStatus}
            rowVersion={it.rowVersion}
          />
        ) : null}
      </div>
    </article>
  );
}

export default function ScheduleView({ items }: { items: ScheduleItem[] }) {
  if (items.length === 0) {
    return (
      <div className="sg-empty">
        <div className="sg-empty__title">Nothing on your schedule yet</div>
        <p style={{ margin: 0 }}>
          If you just signed in, your hosts may still be finalizing invitations. Check back soon — your events
          will appear here.
        </p>
      </div>
    );
  }

  const multiGuest = new Set(items.map((i) => i.guestId)).size > 1;

  return (
    <div className="sg-list">
      {items.map((it) => (
        <EventCard key={it.invitationGuestId} it={it} multiGuest={multiGuest} />
      ))}
    </div>
  );
}
