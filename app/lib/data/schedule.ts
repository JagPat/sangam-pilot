import type { AppSupabaseClient } from '../supabase/clients';
import type { AttendanceStatus } from '../commands/rsvp';

// The signed-in guest's personalized schedule. Every query runs under the guest's own session, so RLS
// returns ONLY the instances they're invited to (via a guest they can act for). We fetch the few related
// tables explicitly and join in JS rather than relying on PostgREST embedding across composite FKs — the
// join keys are all (wedding_id, id) and the result set is small (one wedding's events).
//
// Phase-1 enrichment ("Know before you go") surfaces data that already exists in the schema: the venue
// (address, map link), the dress code, the muhurat and tithi/choghadiya, the live-stream link, and the
// two-family accent (via event_host_group -> host_group.kind). No new tables.

export type FamilySide = 'bride' | 'groom' | 'mutual';

export type ScheduleItem = {
  invitationGuestId: string;
  eventInstanceId: string;
  guestId: string;
  guestName: string | null;
  functionName: string | null;
  functionType: string | null;
  tz: string;
  arrivalInstant: string | null;
  arrivalWallLocal: string | null;
  arrivalOffsetMinutes: number | null;
  ceremonyInstant: string | null;
  venueName: string | null;
  venueAddress: string | null;
  directionsUrl: string | null;
  dressCode: string | null;
  muhuratKind: string | null;
  muhuratStartInstant: string | null;
  muhuratEndInstant: string | null;
  choghadiyaText: string | null;
  tithiText: string | null;
  streamUrl: string | null;
  familySide: FamilySide | null;
  cancelled: boolean;
  rsvpStatus: AttendanceStatus | null;
  rowVersion: number | null;
};

function directionsFor(v: { map_url: string | null; lat: number | null; lng: number | null; address: string | null } | undefined): string | null {
  if (!v) return null;
  if (v.map_url) return v.map_url;
  if (v.lat != null && v.lng != null) return `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`;
  if (v.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`;
  return null;
}

function sideFromKinds(kinds: string[]): FamilySide | null {
  const sides = new Set(kinds.map((k) => (k === 'bride_family' ? 'bride' : k === 'groom_family' ? 'groom' : 'mutual')));
  if (sides.size === 1 && sides.has('bride')) return 'bride';
  if (sides.size === 1 && sides.has('groom')) return 'groom';
  return sides.size ? 'mutual' : null;
}

export async function getGuestSchedule(db: AppSupabaseClient): Promise<ScheduleItem[]> {
  const app = db.schema('app');

  const { data: igs, error: e1 } = await app
    .from('invitation_guest')
    .select('id, event_instance_id, guest_id');
  if (e1) throw e1;
  if (!igs || igs.length === 0) return [];

  const instanceIds = [...new Set(igs.map((r) => r.event_instance_id))];
  const guestIds = [...new Set(igs.map((r) => r.guest_id))];
  const igIds = igs.map((r) => r.id);

  const [inst, guests, att, ehg] = await Promise.all([
    app
      .from('event_instance')
      .select(
        'id, event_function_id, venue_id, iana_timezone, arrival, ceremony_start, muhurat_kind, muhurat_start, muhurat_end, choghadiya_text, tithi_text, dress_code, stream_url, scheduled_status',
      )
      .in('id', instanceIds),
    app.from('guest').select('id, full_name').in('id', guestIds),
    app.from('event_attendance').select('invitation_guest_id, status, row_version').in('invitation_guest_id', igIds),
    app.from('event_host_group').select('event_instance_id, host_group_id').in('event_instance_id', instanceIds),
  ]);
  if (inst.error) throw inst.error;
  if (guests.error) throw guests.error;
  if (att.error) throw att.error;
  if (ehg.error) throw ehg.error;

  const functionIds = [...new Set((inst.data ?? []).map((r) => r.event_function_id))];
  const venueIds = [...new Set((inst.data ?? []).map((r) => r.venue_id).filter((v): v is string => Boolean(v)))];
  const hostGroupIds = [...new Set((ehg.data ?? []).map((r) => r.host_group_id))];

  const [funcs, venues, groups] = await Promise.all([
    app.from('event_function').select('id, name, type').in('id', functionIds),
    app.from('venue').select('id, name, address, lat, lng, map_url').in('id', venueIds),
    hostGroupIds.length
      ? app.from('host_group').select('id, kind').in('id', hostGroupIds)
      : Promise.resolve({ data: [], error: null } as { data: { id: string; kind: string }[]; error: null }),
  ]);
  if (funcs.error) throw funcs.error;
  if (venues.error) throw venues.error;
  if (groups.error) throw groups.error;

  const instById = new Map((inst.data ?? []).map((r) => [r.id, r]));
  const guestById = new Map((guests.data ?? []).map((r) => [r.id, r]));
  const attByIg = new Map((att.data ?? []).map((r) => [r.invitation_guest_id, r]));
  const funcById = new Map((funcs.data ?? []).map((r) => [r.id, r]));
  const venueById = new Map((venues.data ?? []).map((r) => [r.id, r]));
  const kindByGroup = new Map((groups.data ?? []).map((r) => [r.id, r.kind]));

  // instance -> the set of host_group kinds hosting it
  const kindsByInstance = new Map<string, string[]>();
  for (const row of ehg.data ?? []) {
    const kind = kindByGroup.get(row.host_group_id);
    if (!kind) continue;
    const arr = kindsByInstance.get(row.event_instance_id) ?? [];
    arr.push(kind);
    kindsByInstance.set(row.event_instance_id, arr);
  }

  const items: ScheduleItem[] = igs.map((ig) => {
    const ei = instById.get(ig.event_instance_id);
    const fn = ei ? funcById.get(ei.event_function_id) : undefined;
    const ve = ei?.venue_id ? venueById.get(ei.venue_id) : undefined;
    const a = attByIg.get(ig.id);
    const arrival = ei?.arrival ?? null;
    return {
      invitationGuestId: ig.id,
      eventInstanceId: ig.event_instance_id,
      guestId: ig.guest_id,
      guestName: guestById.get(ig.guest_id)?.full_name ?? null,
      functionName: fn?.name ?? null,
      functionType: fn?.type ?? null,
      tz: ei?.iana_timezone ?? 'UTC',
      arrivalInstant: arrival?.instant ?? null,
      arrivalWallLocal: arrival?.wall_local ?? null,
      arrivalOffsetMinutes: arrival?.offset_minutes ?? null,
      ceremonyInstant: ei?.ceremony_start?.instant ?? null,
      venueName: ve?.name ?? null,
      venueAddress: ve?.address ?? null,
      directionsUrl: directionsFor(ve),
      dressCode: ei?.dress_code ?? null,
      muhuratKind: ei?.muhurat_kind ?? null,
      muhuratStartInstant: ei?.muhurat_start?.instant ?? null,
      muhuratEndInstant: ei?.muhurat_end?.instant ?? null,
      choghadiyaText: ei?.choghadiya_text ?? null,
      tithiText: ei?.tithi_text ?? null,
      streamUrl: ei?.stream_url ?? null,
      familySide: sideFromKinds(kindsByInstance.get(ig.event_instance_id) ?? []),
      cancelled: (ei?.scheduled_status ?? 'scheduled') === 'cancelled',
      rsvpStatus: (a?.status as AttendanceStatus | undefined) ?? null,
      rowVersion: a?.row_version ?? null,
    };
  });

  items.sort((x, y) => (x.arrivalInstant ?? '').localeCompare(y.arrivalInstant ?? ''));
  return items;
}
