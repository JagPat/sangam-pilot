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
type VenueRow = { id: string; wedding_id: string; name: string; iana_timezone: string; address: string | null; lat: number | null; lng: number | null; map_url: string | null };
type EventFunctionRow = { id: string; wedding_id: string; name: string; type: string };
type EventInstanceRow = {
  id: string; wedding_id: string; event_function_id: string; venue_id: string | null; iana_timezone: string;
  arrival: ZonedTime; ceremony_start: ZonedTime | null;
  muhurat_kind: string | null; muhurat_start: ZonedTime | null; muhurat_end: ZonedTime | null;
  choghadiya_text: string | null; tithi_text: string | null;
  dress_code: string | null; alcohol_available: boolean; stream_url: string | null; scheduled_status: string;
};
type EventHostGroupRow = { wedding_id: string; event_instance_id: string; host_group_id: string };
type InvitationGuestRow = { id: string; wedding_id: string; invitation_id: string; event_instance_id: string; guest_id: string };
type EventAttendanceRow = { id: string; wedding_id: string; invitation_guest_id: string; status: string; responded_channel: string; responded_as: string; row_version: number };
type GuestRow = { id: string; wedding_id: string; household_id: string; full_name: string; self_account_id: string | null; show_in_directory: boolean };
type WeddingRow = { id: string; title: string; couple_names: string | null; default_timezone: string; start_date: string | null; end_date: string | null };
type HouseholdRow = { id: string; wedding_id: string; name: string; host_group_id: string | null; primary_contact_id: string | null };
type HouseholdContactRow = { id: string; wedding_id: string; household_id: string; guest_id: string | null; channel: string; value: string; is_shared: boolean };
type InvitationRow = { id: string; wedding_id: string; household_id: string; event_instance_id: string; status: string; rsvp_deadline_at: string | null; plus_one_allowance: number };
type OperatorRoleRow = { id: string; wedding_id: string; account_id: string; role: string; host_group_id: string | null };
type HostGroupRow = { id: string; wedding_id: string; kind: string; name: string };
type FinanceExpenseRow = { id: string; wedding_id: string; description: string; category: string; amount: number; currency_code: string; paid_at: string; paid_by_host_group_id: string; created_by_account_id: string | null; note: string | null; created_at: string };
type FinanceAllocationRow = { id: string; wedding_id: string; expense_id: string; responsible_host_group_id: string; allocation_amount: number };
type FinanceNetPositionRow = { wedding_id: string; host_group_id: string; currency_code: string; paid_amount: number; allocated_amount: number; net_position: number };
type VendorRow = { id: string; wedding_id: string; category: string; name: string; contact_name: string | null; email: string | null; phone: string | null; host_group_id: string | null; notes: string | null; created_at: string };
type EngagementRow = { id: string; wedding_id: string; vendor_id: string; event_instance_id: string | null; state: string; role_title: string | null; blurb: string | null; quote_amount: number | null; quote_currency: string | null; notes: string | null; created_at: string; updated_at: string };
type GuestDietaryProfileRow = { id: string; wedding_id: string; guest_id: string; category: string; jain_strictness: string | null; no_onion_garlic: boolean; fasting_days: string[]; allergies: string | null; created_at: string };
type HotelRow = { id: string; wedding_id: string; name: string; address: string | null; map_url: string | null; notes: string | null; created_at: string };
type RoomRow = { id: string; wedding_id: string; hotel_id: string; label: string; room_type: string; capacity: number; floor: string | null; wing: string | null; nightly_rate: number | null; currency: string | null; out_of_service: boolean; notes: string | null };
type RoomAllocationRow = { id: string; wedding_id: string; room_id: string; household_id: string; check_in: string | null; check_out: string | null; status: string; notes: string | null; created_at: string };
type RoomOccupantRow = { id: string; wedding_id: string; allocation_id: string; guest_id: string };
type StayRequestRow = { id: string; wedding_id: string; household_id: string; status: string; party_size: number | null; nights: number | null; arrive_on: string | null; depart_on: string | null; preferred_type: string | null; accessibility: string | null; notes: string | null; created_at: string; updated_at: string };
type TravelDetailRow = { id: string; wedding_id: string; guest_id: string; direction: string; mode: string | null; at_instant: string | null; carrier: string | null; number: string | null; from_place: string | null; to_place: string | null; arranged_by: string; needs_pickup: boolean; pickup_status: string; luggage_note: string | null; updated_at: string };
type MyStayRow = { allocation_id: string; wedding_id: string; room_label: string; room_type: string; capacity: number; hotel_name: string; check_in: string | null; check_out: string | null; status: string; roommates: string[] };
type RoomOccupancyRow = { wedding_id: string; hotel_id: string; room_id: string; label: string; room_type: string; capacity: number; out_of_service: boolean; allocation_id: string | null; household_id: string | null; status: string | null; occupants: number; is_occupied: boolean };
type StaySummaryRow = { wedding_id: string; room_type: string; total_rooms: number; occupied_rooms: number; free_rooms: number; out_of_service: number };

// Owner-only aggregate views (security_invoker + is_wedding_owner filter): rows come back ONLY for weddings
// the signed-in account owns; empty for everyone else. Counts are bigint → coerce with Number() at use.
type InstanceRsvpCountsRow = { wedding_id: string; event_instance_id: string; accepted: number; declined: number; tentative: number };
type CatererReportRow = { wedding_id: string; event_instance_id: string; category: string; head_count: number };
type DirectoryEntryRow = { wedding_id: string; guest_id: string; full_name: string | null; relationship_label: string | null; kinship_term: string | null; side_default: string | null; name_pronunciation_clip_url: string | null };
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
      event_host_group: { Row: EventHostGroupRow; Insert: Partial<EventHostGroupRow>; Update: Partial<EventHostGroupRow>; Relationships: [] };
      invitation_guest: { Row: InvitationGuestRow; Insert: Partial<InvitationGuestRow>; Update: Partial<InvitationGuestRow>; Relationships: [] };
      event_attendance: { Row: EventAttendanceRow; Insert: Partial<EventAttendanceRow>; Update: Partial<EventAttendanceRow>; Relationships: [] };
      guest: { Row: GuestRow; Insert: Partial<GuestRow>; Update: Partial<GuestRow>; Relationships: [] };
      wedding: { Row: WeddingRow; Insert: Partial<WeddingRow>; Update: Partial<WeddingRow>; Relationships: [] };
      household: { Row: HouseholdRow; Insert: Partial<HouseholdRow>; Update: Partial<HouseholdRow>; Relationships: [] };
      household_contact: { Row: HouseholdContactRow; Insert: Partial<HouseholdContactRow>; Update: Partial<HouseholdContactRow>; Relationships: [] };
      invitation: { Row: InvitationRow; Insert: Partial<InvitationRow>; Update: Partial<InvitationRow>; Relationships: [] };
      operator_role: { Row: OperatorRoleRow; Insert: Partial<OperatorRoleRow>; Update: Partial<OperatorRoleRow>; Relationships: [] };
      host_group: { Row: HostGroupRow; Insert: Partial<HostGroupRow>; Update: Partial<HostGroupRow>; Relationships: [] };
      finance_expense: { Row: FinanceExpenseRow; Insert: Partial<FinanceExpenseRow>; Update: Partial<FinanceExpenseRow>; Relationships: [] };
      finance_expense_allocation: { Row: FinanceAllocationRow; Insert: Partial<FinanceAllocationRow>; Update: Partial<FinanceAllocationRow>; Relationships: [] };
      vendor: { Row: VendorRow; Insert: Partial<VendorRow>; Update: Partial<VendorRow>; Relationships: [] };
      engagement: { Row: EngagementRow; Insert: Partial<EngagementRow>; Update: Partial<EngagementRow>; Relationships: [] };
      guest_dietary_profile: { Row: GuestDietaryProfileRow; Insert: Partial<GuestDietaryProfileRow>; Update: Partial<GuestDietaryProfileRow>; Relationships: [] };
      hotel: { Row: HotelRow; Insert: Partial<HotelRow>; Update: Partial<HotelRow>; Relationships: [] };
      room: { Row: RoomRow; Insert: Partial<RoomRow>; Update: Partial<RoomRow>; Relationships: [] };
      room_allocation: { Row: RoomAllocationRow; Insert: Partial<RoomAllocationRow>; Update: Partial<RoomAllocationRow>; Relationships: [] };
      room_occupant: { Row: RoomOccupantRow; Insert: Partial<RoomOccupantRow>; Update: Partial<RoomOccupantRow>; Relationships: [] };
      stay_request: { Row: StayRequestRow; Insert: Partial<StayRequestRow>; Update: Partial<StayRequestRow>; Relationships: [] };
      travel_detail: { Row: TravelDetailRow; Insert: Partial<TravelDetailRow>; Update: Partial<TravelDetailRow>; Relationships: [] };
    };
    Views: {
      instance_rsvp_counts: { Row: InstanceRsvpCountsRow; Relationships: [] };
      caterer_report: { Row: CatererReportRow; Relationships: [] };
      directory_entry: { Row: DirectoryEntryRow; Relationships: [] };
      room_occupancy: { Row: RoomOccupancyRow; Relationships: [] };
      stay_summary: { Row: StaySummaryRow; Relationships: [] };
      attendance_expanded: { Row: AttendanceExpandedRow; Relationships: [] };
      finance_net_position: { Row: FinanceNetPositionRow; Relationships: [] };
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
      // The signed-in guest's own room assignment(s) — definer-gated to guests the caller can act for.
      my_stay: {
        Args: Record<string, never>;
        Returns: MyStayRow[];
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
        Args: {
          p_wedding: string; p_name: string; p_type: string | null; p_venue: string | null; p_wall: string; p_tz: string | null;
          p_dress?: string | null; p_muhurat_wall?: string | null; p_tithi?: string | null;
          p_choghadiya?: string | null; p_stream?: string | null; p_host_groups?: string[] | null;
        };
        Returns: string;
      };
      // Owner-only: atomically delete a guest and all of its owned detail rows (contact, dietary, directory
      // consent, …). Raises SQLSTATE SA001 if the guest is still invited to any event.
      owner_delete_guest: {
        Args: { p_wedding: string; p_guest: string };
        Returns: undefined;
      };
      // Owner-only: edit/cancel an existing event.
      owner_update_event: {
        Args: {
          p_wedding: string; p_instance: string; p_name: string | null; p_type: string | null; p_venue: string | null; p_wall: string | null; p_tz: string | null; p_cancelled: boolean;
          p_dress?: string | null; p_muhurat_wall?: string | null; p_tithi?: string | null;
          p_choghadiya?: string | null; p_stream?: string | null; p_host_groups?: string[] | null;
        };
        Returns: undefined;
      };
      // Owner-only finance writes. p_allocations is a JSON array of {group, percent} OR {group, amount}.
      owner_add_expense: {
        Args: { p_wedding: string; p_description: string; p_category: string | null; p_amount: number; p_currency: string; p_paid_at: string; p_paid_by_host_group: string; p_note: string | null; p_allocations: Json };
        Returns: string;
      };
      owner_update_expense: {
        Args: { p_wedding: string; p_expense: string; p_description: string; p_category: string | null; p_amount: number; p_currency: string; p_paid_at: string; p_paid_by_host_group: string; p_note: string | null; p_allocations: Json };
        Returns: undefined;
      };
      owner_delete_expense: {
        Args: { p_wedding: string; p_expense: string };
        Returns: undefined;
      };
      // Owner-only family (host_group) + family-admin management (0012).
      owner_create_host_group: {
        Args: { p_wedding: string; p_kind: string; p_name: string };
        Returns: string;
      };
      owner_rename_host_group: {
        Args: { p_wedding: string; p_group: string; p_name: string };
        Returns: undefined;
      };
      owner_delete_host_group: {
        Args: { p_wedding: string; p_group: string };
        Returns: undefined;
      };
      // Assign a family admin (or co-host) by email; mints an unlinked account if needed. Returns account id.
      owner_assign_group_admin: {
        Args: { p_wedding: string; p_host_group: string; p_email: string; p_role: string };
        Returns: string;
      };
      owner_remove_operator_role: {
        Args: { p_wedding: string; p_operator_role: string };
        Returns: undefined;
      };
      // Owner-gated read: operators + their email (which account RLS otherwise hides).
      owner_list_operators: {
        Args: { p_wedding: string };
        Returns: { id: string; account_id: string; role: string; host_group_id: string | null; email: string | null; linked: boolean }[];
      };
      // Guest-facing: confirmed performers for the events the caller is invited to (no vendor list / quotes).
      my_event_performers: {
        Args: Record<string, never>;
        Returns: { event_instance_id: string; vendor_name: string; role_title: string | null; blurb: string | null }[];
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
