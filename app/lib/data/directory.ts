import type { AppSupabaseClient } from '../supabase/clients';

// The consent-respecting guest directory ("Who's coming"). Reads app.directory_entry — a definer-rights
// view that already enforces three things: members-only visibility (app.is_member), the organizer's
// per-guest show_in_directory flag, and each guest's own per-field 'name' consent. Contact details are
// NEVER exposed by the view (safe columns only). READ ONLY; runs under the guest's own session.

export type DirectoryEntry = {
  weddingId: string;
  guestId: string;
  fullName: string | null;
  relationship: string | null;
  side: string | null; // 'bride' | 'groom' | ... when the organizer has set a default side, else null
};

export async function getGuestDirectory(db: AppSupabaseClient): Promise<DirectoryEntry[]> {
  const app = db.schema('app');
  const { data, error } = await app
    .from('directory_entry')
    .select('wedding_id, guest_id, full_name, relationship_label, side_default');
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({
      weddingId: r.wedding_id,
      guestId: r.guest_id,
      fullName: r.full_name ?? null,
      relationship: r.relationship_label ?? null,
      side: r.side_default ?? null,
    }))
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''));
}
