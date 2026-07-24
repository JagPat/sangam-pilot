import type { AppSupabaseClient } from '../supabase/clients';
import { getOperatorContext } from './owner';

// Read model for the family-admin events screen (/host/events) — Stay/roadmap layer: a bride/groom-side admin
// creating & editing the events THEIR side hosts. They can read the whole schedule (0016), but only events
// their side hosts are editable; writes go through the group_* RPCs (0021), which enforce the scope. READ
// ONLY here; mutations live in app/host/events/actions.ts.

export const EVENT_TYPES = [
  { value: 'haldi', label: 'Haldi' },
  { value: 'mehndi', label: 'Mehndi' },
  { value: 'sangeet', label: 'Sangeet' },
  { value: 'ceremony', label: 'Wedding ceremony' },
  { value: 'reception', label: 'Reception' },
  { value: 'baraat', label: 'Baraat' },
  { value: 'puja', label: 'Puja' },
  { value: 'other', label: 'Other' },
] as const;

export type FamilyVenue = { id: string; name: string; tz: string };
export type FamilyEvent = {
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
  mine: boolean;          // does the caller's side host this event → editable
  hostNames: string[];
};
export type FamilyEventsWedding = {
  weddingId: string;
  title: string;
  defaultTimezone: string;
  adminGroupId: string;
  adminGroupName: string | null;
  venues: FamilyVenue[];
  events: FamilyEvent[];
};

export async function getFamilyEvents(db: AppSupabaseClient): Promise<FamilyEventsWedding[]> {
  const ctx = await getOperatorContext(db);
  const weddingIds = ctx.ids.filter((id) => ctx.byWedding[id]?.adminGroupId);
  if (weddingIds.length === 0) return [];

  const app = db.schema('app');
  const [weds, venues, insts, funcs, groups, ehg] = await Promise.all([
    app.from('wedding').select('id, title, default_timezone').in('id', weddingIds),
    app.from('venue').select('id, wedding_id, name, iana_timezone').in('wedding_id', weddingIds),
    app.from('event_instance').select('id, wedding_id, event_function_id, venue_id, iana_timezone, arrival, scheduled_status, dress_code, muhurat_start, tithi_text, choghadiya_text, stream_url').in('wedding_id', weddingIds),
    app.from('event_function').select('id, wedding_id, name, type').in('wedding_id', weddingIds),
    app.from('host_group').select('id, wedding_id, name').in('wedding_id', weddingIds),
    app.from('event_host_group').select('event_instance_id, host_group_id').in('wedding_id', weddingIds),
  ]);
  for (const r of [weds, venues, insts, funcs, groups, ehg]) if (r.error) throw r.error;

  const funcById = new Map((funcs.data ?? []).map((f) => [f.id, f]));
  const venueById = new Map((venues.data ?? []).map((v) => [v.id, v]));
  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const hgByInstance = new Map<string, string[]>();
  for (const row of ehg.data ?? []) {
    const arr = hgByInstance.get(row.event_instance_id) ?? [];
    arr.push(row.host_group_id);
    hgByInstance.set(row.event_instance_id, arr);
  }

  return (weds.data ?? []).map((w) => {
    const adminGroupId = ctx.byWedding[w.id].adminGroupId as string;
    return {
      weddingId: w.id,
      title: w.title,
      defaultTimezone: w.default_timezone ?? 'Asia/Kolkata',
      adminGroupId,
      adminGroupName: groupName.get(adminGroupId) ?? null,
      venues: (venues.data ?? [])
        .filter((v) => v.wedding_id === w.id)
        .map((v) => ({ id: v.id, name: v.name, tz: v.iana_timezone }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      events: (insts.data ?? [])
        .filter((i) => i.wedding_id === w.id)
        .map((i) => {
          const fn = funcById.get(i.event_function_id);
          const ve = i.venue_id ? venueById.get(i.venue_id) : undefined;
          const hgs = hgByInstance.get(i.id) ?? [];
          return {
            eventInstanceId: i.id,
            functionName: fn?.name ?? null,
            functionType: fn?.type ?? null,
            venueId: i.venue_id ?? null,
            venueName: ve?.name ?? null,
            whenInstant: i.arrival?.instant ?? null,
            wallLocal: i.arrival?.wall_local ?? null,
            tz: i.iana_timezone ?? 'Asia/Kolkata',
            cancelled: i.scheduled_status === 'cancelled',
            dressCode: i.dress_code ?? null,
            muhuratWall: i.muhurat_start?.wall_local ?? null,
            tithiText: i.tithi_text ?? null,
            choghadiyaText: i.choghadiya_text ?? null,
            streamUrl: i.stream_url ?? null,
            mine: hgs.includes(adminGroupId),
            hostNames: hgs.map((g) => groupName.get(g) ?? '—'),
          };
        })
        .sort((a, b) => (a.whenInstant ?? '').localeCompare(b.whenInstant ?? '')),
    };
  });
}
