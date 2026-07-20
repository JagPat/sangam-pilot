import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the wedding-shell setup screen (/host/setup): venues + events for the weddings the
// signed-in account owns. READ ONLY; mutations go through app/host/setup/actions.ts (create_wedding /
// owner_create_event / owner_update_event RPCs, and plain owner_write RLS for venues).

export type SetupVenue = { id: string; name: string; tz: string; address: string | null };

export type SetupEvent = {
  eventInstanceId: string;
  functionName: string | null;
  functionType: string | null;
  venueId: string | null;
  venueName: string | null;
  whenInstant: string | null;
  wallLocal: string | null;
  tz: string;
  cancelled: boolean;
};

export type SetupWedding = {
  weddingId: string;
  title: string;
  defaultTimezone: string;
  startDate: string | null;
  endDate: string | null;
  venues: SetupVenue[];
  events: SetupEvent[];
};

export async function getSetupData(db: AppSupabaseClient): Promise<SetupWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, venues, insts, funcs] = await Promise.all([
    app.from('wedding').select('id, title, default_timezone, start_date, end_date').in('id', weddingIds),
    app.from('venue').select('id, wedding_id, name, iana_timezone, address').in('wedding_id', weddingIds),
    app.from('event_instance').select('id, wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status').in('wedding_id', weddingIds),
    app.from('event_function').select('id, wedding_id, name, type').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, venues, insts, funcs]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((f) => [f.id, f]));
  const venueById = new Map((venues.data ?? []).map((v) => [v.id, v]));

  return (weds.data ?? []).map((w) => ({
    weddingId: w.id,
    title: w.title,
    defaultTimezone: w.default_timezone ?? 'Asia/Kolkata',
    startDate: w.start_date ?? null,
    endDate: w.end_date ?? null,
    venues: (venues.data ?? [])
      .filter((v) => v.wedding_id === w.id)
      .map((v) => ({ id: v.id, name: v.name, tz: v.iana_timezone, address: v.address ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    events: (insts.data ?? [])
      .filter((i) => i.wedding_id === w.id)
      .map((i) => {
        const fn = funcById.get(i.event_function_id);
        const ve = i.venue_id ? venueById.get(i.venue_id) : undefined;
        return {
          eventInstanceId: i.id,
          functionName: fn?.name ?? null,
          functionType: fn?.type ?? null,
          venueId: i.venue_id ?? null,
          venueName: ve?.name ?? null,
          whenInstant: i.arrival?.instant ?? null,
          wallLocal: i.arrival?.wall_local ?? null,
          tz: i.iana_timezone ?? 'UTC',
          cancelled: i.scheduled_status === 'cancelled',
        };
      })
      .sort((a, b) => (a.whenInstant ?? '').localeCompare(b.whenInstant ?? '')),
  }));
}
