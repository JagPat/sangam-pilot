// The ONE RSVP command path. Web UI calls these; the WhatsApp bot (fast-follow) will call the SAME
// SQL functions (app.propose_rsvp_change / app.confirm_rsvp_change). Never mutate app.event_attendance
// directly — the two-step propose -> confirm flow is what makes "confirm before the mutation" real.

import type { AppSupabaseClient } from '../supabase/clients';

export type AttendanceStatus = 'accepted' | 'declined' | 'tentative';

/** Step 1: create a pending proposal. Does NOT change attendance. Returns the proposal id to echo/confirm.
 *  Provenance (web vs proxy) is DERIVED server-side — the client cannot set the source. */
export async function proposeRsvpChange(
  db: AppSupabaseClient,
  invitationGuestId: string,
  status: AttendanceStatus,
): Promise<string> {
  const { data, error } = await db.rpc('propose_rsvp_change', {
    p_invitation_guest: invitationGuestId,
    p_status: status,
  });
  if (error) throw error;
  return data as string; // proposal id
}

/** Step 2: confirm. Transactionally writes attendance + audit. Pass expectedVersion for optimistic
 *  concurrency (guest vs proxy races); omit on first response. */
export async function confirmRsvpChange(
  db: AppSupabaseClient,
  proposalId: string,
  expectedVersion?: number,
): Promise<string> {
  const { data, error } = await db.rpc('confirm_rsvp_change', {
    p_proposal: proposalId,
    p_expected_version: expectedVersion ?? null,
  });
  if (error) throw error; // includes 'rsvp conflict' on a stale version, and auth failures
  return data as string; // event_attendance id
}

// Typical UI/bot flow:
//   const pid = await proposeRsvpChange(db, ig, 'accepted');
//   // echo: "You marked Jayaben attending Sangeet — confirm?"  (nothing has changed yet)
//   await confirmRsvpChange(db, pid, currentVersion);
