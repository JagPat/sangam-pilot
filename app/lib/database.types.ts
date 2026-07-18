// Hand-written to match the Supabase-generated shape for the slice-1 surface the app actually uses.
// Regenerate the full version once migrations are applied to your project:
//   supabase gen types typescript --local --schema app,public > app/lib/database.types.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type EmptyMap = Record<string, never>;

// app.zoned_time composite (0003): a composite column is returned by PostgREST as a JSON object with these
// attribute names. Verify the serialization on Supabase-local (release gate) if display looks off.
export type ZonedTime = {
  instant: string | null;
  wall_local: string | null;
  offset_minutes: number | null;
  source: string | null;
};

// Read shapes for the Slice-1 schedule/RSVP surface (the columns the app selects). RLS governs which rows
// come back; these types only describe columns, not visibility.
type VenueRow = { id: string; wedding_id: string; name: string; iana_timezone: string; address: string | null; map_url: string | null };
type EventFunctionRow = { id: string; wedding_id: string; name: string; type: string };
type EventInstanceRow = { id: string; wedding_id: string; event_function_id: string; venue_id: string | null; iana_timezone: string; arrival: ZonedTime; scheduled_status: string };
type InvitationGuestRow = { id: string; wedding_id: string; invitation_id: string; event_instance_id: string; guest_id: string };
type EventAttendanceRow = { id: string; wedding_id: string; invitation_guest_id: string; status: string; responded_channel: string; responded_as: string; row_version: number };
type GuestRow = { id: string; wedding_id: string; household_id: string; full_name: string; self_account_id: string | null; show_in_directory: boolean };

export type Database = {
  app: {
    Tables: {
      account: {
        Row: {
          id: string;
          auth_user_id: string | null;
          phone: string | null;
          email: string | null;
          preferred_language: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          phone?: string | null;
          email?: string | null;
          preferred_language?: string;
          status?: string;
        };
        Update: {
          auth_user_id?: string | null;
          phone?: string | null;
          email?: string | null;
          preferred_language?: string;
          status?: string;
        };
        Relationships: [];
      };
      venue: { Row: VenueRow; Insert: Partial<VenueRow>; Update: Partial<VenueRow>; Relationships: [] };
      event_function: { Row: EventFunctionRow; Insert: Partial<EventFunctionRow>; Update: Partial<EventFunctionRow>; Relationships: [] };
      event_instance: { Row: EventInstanceRow; Insert: Partial<EventInstanceRow>; Update: Partial<EventInstanceRow>; Relationships: [] };
      invitation_guest: { Row: InvitationGuestRow; Insert: Partial<InvitationGuestRow>; Update: Partial<InvitationGuestRow>; Relationships: [] };
      event_attendance: { Row: EventAttendanceRow; Insert: Partial<EventAttendanceRow>; Update: Partial<EventAttendanceRow>; Relationships: [] };
      guest: { Row: GuestRow; Insert: Partial<GuestRow>; Update: Partial<GuestRow>; Relationships: [] };
    };
    Views: EmptyMap;
    Functions: {
      // Recipient-bound: the verified session contact must match the invited contact.
      redeem_and_bind: {
        Args: { p_raw: string; p_account: string; p_verified_contact: string };
        Returns: { wedding_id: string; guest_id: string }[];
      };
      // Validity only — NO PII (safe for the unauthenticated preview).
      peek_access_link: {
        Args: { p_raw: string };
        Returns: { wedding_id: string | null; valid: boolean }[];
      };
      // Named details — call only after a verified session; recipient-bound (returns the name only on a
      // verified-contact match).
      peek_invite_details: {
        Args: { p_raw: string; p_verified_contact: string };
        Returns: { wedding_id: string | null; guest_id: string | null; guest_name: string | null; valid: boolean }[];
      };
      issue_access_link: {
        Args: { p_wedding: string; p_guest: string; p_contact: string; p_ttl?: string };
        Returns: string;
      };
    };
    Enums: EmptyMap;
    CompositeTypes: EmptyMap;
  };
  public: {
    Tables: EmptyMap;
    Views: EmptyMap;
    Functions: {
      // No p_source: provenance is derived server-side, not accepted from the client.
      propose_rsvp_change: {
        Args: { p_invitation_guest: string; p_status: string };
        Returns: string;
      };
      confirm_rsvp_change: {
        Args: { p_proposal: string; p_expected_version?: number | null };
        Returns: string;
      };
    };
    Enums: EmptyMap;
    CompositeTypes: EmptyMap;
  };
};
