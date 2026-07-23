import type { AppSupabaseClient } from '../supabase/clients';
import { ownedWeddingIds } from './owner';

// Read model for the wedding-shell setup screen (/host/setup): venues + events for the weddings the
// signed-in account owns, including the Phase-2 enrichment (dress/muhurat/tithi/choghadiya/stream) and the
// hosting-family assignments (event_host_group). READ ONLY; mutations go through app/host/setup/actions.ts.

export type SetupVenue = { id: string; name: string; tz: string; address: string | null; mapUrl: string | null };

export type SetupFamily = { id: string; name: string; kind: string };

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
  dressCode: string | null;
  muhuratWall: string | null;
  tithiText: string | null;
  choghadiyaText: string | null;
  streamUrl: string | null;
  hostGroupIds: string[];
};

export type SetupWedding = {
  weddingId: string;
  title: string;
  defaultTimezone: string;
  startDate: string | null;
  endDate: string | null;
  families: SetupFamily[];
  venues: SetupVenue[];
  events: SetupEvent[];
};

export async function getSetupData(db: AppSupabaseClient): Promise<SetupWedding[]> {
  const app = db.schema('app');
  const weddingIds = await ownedWeddingIds(db);
  if (weddingIds.length === 0) return [];

  const [weds, venues, insts, funcs, groups, ehg] = await Promise.all([
    app.from('wedding').select('id, title, default_timezone, start_date, end_date').in('id', weddingIds),
    app.from('venue').select('id, wedding_id, name, iana_timezone, address, map_url').in('wedding_id', weddingIds),
    app
      .from('event_instance')
      .select(
        'id, wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status, dress_code, muhurat_start, tithi_text, choghadiya_text, stream_url',
      )
      .in('wedding_id', weddingIds),
    app.from('event_function').select('id, wedding_id, name, type').in('wedding_id', weddingIds),
    app.from('host_group').select('id, wedding_id, name, kind').in('wedding_id', weddingIds),
    app.from('event_host_group').select('event_instance_id, host_group_id').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, venues, insts, funcs, groups, ehg]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((f) => [f.id, f]));
  const venueById = new Map((venues.data ?? []).map((v) => [v.id, v]));
  const hgByInstance = new Map<string, string[]>();
  for (const row of ehg.data ?? []) {
    const arr = hgByInstance.get(row.event_instance_id) ?? [];
    arr.push(row.host_group_id);
    hgByInstance.set(row.event_instance_id, arr);
  }

  return (weds.data ?? []).map((w) => ({
    weddingId: w.id,
    title: w.title,
    defaultTimezone: w.default_timezone ?? 'Asia/Kolkata',
    startDate: w.start_date ?? null,
    endDate: w.end_date ?? null,
    families: (groups.data ?? [])
      .filter((g) => g.wedding_id === w.id)
      .map((g) => ({ id: g.id, name: g.name, kind: g.kind }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    venues: (venues.data ?? [])
      .filter((v) => v.wedding_id === w.id)
      .map((v) => ({ id: v.id, name: v.name, tz: v.iana_timezone, address: v.address ?? null, mapUrl: v.map_url ?? null }))
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
          dressCode: i.dress_code ?? null,
          muhuratWall: i.muhurat_start?.wall_local ?? null,
          tithiText: i.tithi_text ?? null,
          choghadiyaText: i.choghadiya_text ?? null,
          streamUrl: i.stream_url ?? null,
          hostGroupIds: hgByInstance.get(i.id) ?? [],
        };
      })
      .sort((a, b) => (a.whenInstant ?? '').localeCompare(b.whenInstant ?? '')),
  }));
}
