import type { AppSupabaseClient } from '../supabase/clients';
import type { AttendanceStatus } from '../commands/rsvp';

// The signed-in guest's personalized schedule. Every query runs under the guest's own session, so RLS
// returns ONLY the instances they're invited to (via a guest they can act for). We fetch the few related
// tables explicitly and join in JS rather than relying on PostgREST embedding across composite FKs — the
// join keys are all (wedding_id, id) and the result set is small (one wedding's events).

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
  venueName: string | null;
  rsvpStatus: AttendanceStatus | null;
  rowVersion: number | null;
};

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

  const [inst, guests, att] = await Promise.all([
    app.from('event_instance').select('id, event_function_id, venue_id, iana_timezone, arrival').in('id', instanceIds),
    app.from('guest').select('id, full_name').in('id', guestIds),
    app.from('event_attendance').select('invitation_guest_id, status, row_version').in('invitation_guest_id', igIds),
  ]);
  if (inst.error) throw inst.error;
  if (guests.error) throw guests.error;
  if (att.error) throw att.error;

  const functionIds = [...new Set((inst.data ?? []).map((r) => r.event_function_id))];
  const venueIds = [...new Set((inst.data ?? []).map((r) => r.venue_id).filter((v): v is string => Boolean(v)))];

  const [funcs, venues] = await Promise.all([
    app.from('event_function').select('id, name, type').in('id', functionIds),
    app.from('venue').select('id, name').in('id', venueIds),
  ]);
  if (funcs.error) throw funcs.error;
  if (venues.error) throw venues.error;

  const instById = new Map((inst.data ?? []).map((r) => [r.id, r]));
  const guestById = new Map((guests.data ?? []).map((r) => [r.id, r]));
  const attByIg = new Map((att.data ?? []).map((r) => [r.invitation_guest_id, r]));
  const funcById = new Map((funcs.data ?? []).map((r) => [r.id, r]));
  const venueById = new Map((venues.data ?? []).map((r) => [r.id, r]));

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
      venueName: ve?.name ?? null,
      rsvpStatus: (a?.status as AttendanceStatus | undefined) ?? null,
      rowVersion: a?.row_version ?? null,
    };
  });

  items.sort((x, y) => (x.arrivalInstant ?? '').localeCompare(y.arrivalInstant ?? ''));
  return items;
}
