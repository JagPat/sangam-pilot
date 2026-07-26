import type { AttendanceStatus } from '@/lib/commands/rsvp';

export type RsvpClientState = {
  status: AttendanceStatus | null;
  rowVersion: number | null;
};

export function applyConfirmedRsvp(
  _before: RsvpClientState,
  committed: { status: AttendanceStatus; rowVersion: number },
): RsvpClientState {
  return committed;
}
