'use server';

// The RSVP command path for the web UI. Both steps go through the SQL functions (propose_rsvp_change ->
// confirm_rsvp_change) as the signed-in guest — never a direct event_attendance write, and never the
// service role. Provenance (channel/authority) is derived server-side inside those functions.

import { revalidatePath } from 'next/cache';
import { pageClient } from '@/lib/supabase/pageClient';
import { proposeRsvpChange, confirmRsvpChange, type AttendanceStatus } from '@/lib/commands/rsvp';

export type ProposeResult = { ok: true; proposalId: string } | { ok: false; error: string };
export type ConfirmResult = { ok: true } | { ok: false; error: string };

// STEP 1 — create a pending proposal. Nothing is written to attendance yet; returns the proposal id to echo.
export async function proposeAction(
  invitationGuestId: string,
  status: AttendanceStatus,
): Promise<ProposeResult> {
  try {
    const db = await pageClient();
    const proposalId = await proposeRsvpChange(db, invitationGuestId, status);
    return { ok: true, proposalId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// STEP 2 — confirm. Transactionally writes attendance + audit; pass the row version for optimistic
// concurrency (a proxy/guest race yields a clean 'rsvp conflict' rather than a lost update).
export async function confirmAction(
  proposalId: string,
  expectedVersion: number | null,
): Promise<ConfirmResult> {
  try {
    const db = await pageClient();
    await confirmRsvpChange(db, proposalId, expectedVersion ?? undefined);
    revalidatePath('/schedule');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
