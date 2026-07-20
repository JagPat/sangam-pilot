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
type WeddingRow = { id: string; title: string; couple_names: string | null; default_timezone: string; start_date: string | null; end_date: string | null };
type HouseholdRow = { id: string; wedding_id: string; name: string };
type HouseholdContactRow = { id: string; wedding_id: string; household_id: string; guest_id: string | null; channel: string; value: string; is_shared: boolean };
type InvitationRow = { id: string; wedding_id: string; household_id: string; event_instance_id: string; status: string; rsvp_deadline_at: string | null; plus_one_allowance: number };
type OperatorRoleRow = { id: string; wedding_id: string; account_id: string; role: string; host_group_id: string | null };

// Owner-only aggregate views (security_invoker + is_wedding_owner filter): rows come back ONLY for weddings
// the signed-in account owns; empty for everyone else. Counts are bigint → coerce with Number() at use.
type InstanceRsvpCountsRow = { wedding_id: string; event_instance_id: string; accepted: number; declined: number; tentative: number };
type CatererReportRow = { wedding_id: string; event_instance_id: string; category: string; head_count: number };
type AttendanceExpandedRow = { id: string; wedding_id: string; event_instance_id: string; guest_id: string; status: string; responded_by_account_id: string | null; responded_channel: string; responded_as: string; responded_at: string; row_version: number };

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
      wedding: { Row: WeddingRow; Insert: Partial<WeddingRow>; Update: Partial<WeddingRow>; Relationships: [] };
      household: { Row: HouseholdRow; Insert: Partial<HouseholdRow>; Update: Partial<HouseholdRow>; Relationships: [] };
      household_contact: { Row: HouseholdContactRow; Insert: Partial<HouseholdContactRow>; Update: Partial<HouseholdContactRow>; Relationships: [] };
      invitation: { Row: InvitationRow; Insert: Partial<InvitationRow>; Update: Partial<InvitationRow>; Relationships: [] };
      operator_role: { Row: OperatorRoleRow; Insert: Partial<OperatorRoleRow>; Update: Partial<OperatorRoleRow>; Relationships: [] };
    };
    Views: {
      instance_rsvp_counts: { Row: InstanceRsvpCountsRow; Relationships: [] };
      caterer_report: { Row: CatererReportRow; Relationships: [] };
      attendance_expanded: { Row: AttendanceExpandedRow; Relationships: [] };
    };
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
      // The signed-in account's app.account id (from auth.uid()); null if no verified session.
      current_account_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      // Service-only: bind the verified auth user to any guest whose personal email matches (returns the
      // resolved account id). Callable only via serviceCommand.
      link_signed_in_account: {
        Args: { p_auth_user_id: string };
        Returns: string;
      };
      // Create a new wedding and make the caller its owner (returns the wedding id). authenticated-callable.
      create_wedding: {
        Args: { p_title: string; p_couple: string | null; p_tz: string | null; p_start: string | null; p_end: string | null };
        Returns: string;
      };
      // Owner-only: create an event (its function + a dated instance); returns the instance id. p_wall is a
      // wall-clock timestamp string, p_tz an IANA zone.
      owner_create_event: {
        Args: { p_wedding: string; p_name: string; p_type: string | null; p_venue: string | null; p_wall: string; p_tz: string | null };
        Returns: string;
      };
      // Owner-only: edit/cancel an existing event.
      owner_update_event: {
        Args: { p_wedding: string; p_instance: string; p_name: string | null; p_type: string | null; p_venue: string | null; p_wall: string | null; p_tz: string | null; p_cancelled: boolean };
        Returns: undefined;
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
