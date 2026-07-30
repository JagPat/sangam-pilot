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
type CostCentreRow = { id: string; wedding_id: string; parent_id: string | null; template_key: string | null; name: string; sort_order: number; active: boolean; created_at: string; updated_at: string };
type CostItemRow = { id: string; wedding_id: string; cost_centre_id: string; event_instance_id: string | null; engagement_id: string | null; title: string; description: string | null; lifecycle_state: string; decision_owner_account_id: string | null; decision_due_at: string | null; created_by_account_id: string; created_at: string; updated_at: string };
type CostEstimateRow = { id: string; wedding_id: string; cost_item_id: string; version_number: number; origin: string; scope_included: string | null; scope_excluded: string | null; quantity: number | null; unit: string | null; unit_rate: number | null; subtotal: number; tax_rate: number; tax_amount: number; total: number; currency_code: string; suggested_engagement_id: string | null; alternative: string | null; saving_proposal: string | null; dependency: string | null; remarks: string | null; decision_due_at: string | null; state: string; created_by_account_id: string; submitted_by_account_id: string | null; created_at: string; submitted_at: string | null };
type CostDecisionRow = { id: string; wedding_id: string; cost_item_id: string; estimate_version_id: string; decision: string; actor_account_id: string; previous_state: string; resulting_state: string; reason: string | null; created_at: string };
type CostCommitmentRow = { id: string; wedding_id: string; cost_item_id: string; approved_estimate_id: string; engagement_id: string | null; quote_reference: string | null; subtotal: number; tax_amount: number; total: number; currency_code: string; commitment_date: string | null; state: string; proposed_by_account_id: string; approved_by_account_id: string | null; decision_reason: string | null; created_at: string; decided_at: string | null };
type CostInvoiceRow = { id: string; wedding_id: string; cost_item_id: string; commitment_id: string | null; invoice_reference: string; subtotal: number; tax_rate: number; tax_amount: number; total: number; currency_code: string; due_date: string | null; state: string; received_by_account_id: string; verified_by_account_id: string | null; verification_reason: string | null; created_at: string; verified_at: string | null };
type CostPaymentRow = { id: string; wedding_id: string; invoice_id: string; amount: number; paid_on: string; method: string; official_reference: string | null; recorded_by_account_id: string; voided_at: string | null; voided_by_account_id: string | null; void_reason: string | null; created_at: string };
type CostControlSummaryRow = { wedding_id: string; currency_code: string; approved_estimate_total: number; committed_total: number; invoiced_total: number; paid_total: number };
type CostControlAttentionRow = { wedding_id: string; cost_item_id: string; attention_kind: string; due_at: string; label: string };
type VendorRow = { id: string; wedding_id: string; category: string; name: string; contact_name: string | null; email: string | null; phone: string | null; host_group_id: string | null; notes: string | null; created_at: string };
type EngagementRow = { id: string; wedding_id: string; vendor_id: string; event_instance_id: string | null; state: string; role_title: string | null; blurb: string | null; quote_amount: number | null; quote_currency: string | null; notes: string | null; created_at: string; updated_at: string };
type GuestDietaryProfileRow = { id: string; wedding_id: string; guest_id: string; category: string; jain_strictness: string | null; no_onion_garlic: boolean; fasting_days: string[]; allergies: string | null; created_at: string };
type HotelRow = { id: string; wedding_id: string; name: string; address: string | null; map_url: string | null; notes: string | null; property_kind: string; property_status: string; created_at: string };
type RoomRow = { id: string; wedding_id: string; hotel_id: string; label: string; provisional_code: string; physical_room_number: string | null; room_type: string; capacity: number; floor: string | null; wing: string | null; nightly_rate: number | null; currency: string | null; out_of_service: boolean; inventory_status: string; sync_revision: number; notes: string | null };
type RoomAllocationRow = { id: string; wedding_id: string; room_id: string; household_id: string | null; primary_household_id: string | null; occupancy_plan: string; single_occupancy_exception_reason: string | null; sharing_confirmed_at: string | null; sharing_confirmed_by: string | null; sharing_confirmed_revision: number | null; sync_revision: number; check_in: string | null; check_out: string | null; status: string; notes: string | null; created_at: string };
type RoomOccupantRow = { id: string; wedding_id: string; allocation_id: string; guest_id: string };
type StayRequestRow = { id: string; wedding_id: string; household_id: string; status: string; party_size: number | null; nights: number | null; arrive_on: string | null; depart_on: string | null; preferred_type: string | null; accessibility: string | null; notes: string | null; created_at: string; updated_at: string };
type TravelDetailRow = { id: string; wedding_id: string; guest_id: string; direction: string; mode: string | null; at_instant: string | null; wall_local: string | null; iana_timezone: string | null; offset_minutes: number | null; carrier: string | null; number: string | null; from_place: string | null; to_place: string | null; arranged_by: string; needs_pickup: boolean; pickup_status: string; luggage_note: string | null; updated_at: string };
type MyStayRow = { allocation_id: string; wedding_id: string; room_label: string; room_type: string; capacity: number; hotel_name: string; check_in: string | null; check_out: string | null; status: string; roommates: string[] };
type ServiceRow = { id: string; wedding_id: string; name: string; description: string | null; category: string | null; billing: string; price_cents: number; currency: string; unit_label: string | null; included_qty: number | null; scope: string; settle_hint: string; capacity: number | null; active: boolean; sort_order: number; created_at: string; updated_at: string };
type ServiceRequestRow = { id: string; wedding_id: string; service_id: string; household_id: string; guest_id: string | null; qty: number; status: string; settle: string; notes: string | null; created_at: string; updated_at: string };
type StayActivityRow = { id: string; wedding_id: string; actor_account_id: string | null; action: string; summary: string; household_id: string | null; guest_id: string | null; created_at: string };
type SheetSyncConnectionRow = { id:string; wedding_id:string; spreadsheet_id:string; enabled:boolean; created_by:string; created_at:string; updated_at:string };
type SheetSyncRunRow = { id:string; wedding_id:string; direction:string; status:string; actor_account_id:string; result:Json|null; created_at:string; completed_at:string|null };
type SheetSyncChangeRow = { id:string; wedding_id:string; run_id:string; change_key:string; allocation_id:string|null; room_id:string|null; base_revision:number; proposed:Json; validation_status:string; validation_codes:string[]; committed_revision:number|null; created_at:string };
type RoomOccupancyRow = { wedding_id: string; hotel_id: string; room_id: string; label: string; room_type: string; capacity: number; out_of_service: boolean; allocation_id: string | null; household_id: string | null; status: string | null; occupants: number; is_occupied: boolean };
type StaySummaryRow = { wedding_id: string; room_type: string; total_rooms: number; occupied_rooms: number; free_rooms: number; out_of_service: number };
type RoomPlanRow = { wedding_id: string; allocation_id: string; room_id: string; primary_household_id: string | null; hotel_id: string; property_name: string; property_kind: string; property_status: string; provisional_code: string; physical_room_number: string | null; capacity: number; inventory_status: string; occupancy_plan: string; single_occupancy_exception_reason: string | null; status: string; check_in: string | null; check_out: string | null; sharing_confirmed_at: string | null; sharing_confirmed_by: string | null; sharing_confirmed_revision: number | null; sync_revision: number; occupant_count: number; guest_ids: string[]; guest_names: string[]; cross_household: boolean };
type RoomPlanSummaryRow = { wedding_id: string; hotel_id: string; property_name: string; occupancy_plan: string; confirmed_rooms: number; draft_rooms: number; missing_physical_numbers: number; unconfirmed_rooms: number };
type RoomPlanExceptionRow = { wedding_id: string; allocation_id: string; room_id: string; exception_code: string; detail: string };
type UnallocatedStayGuestRow = { wedding_id: string; stay_request_id: string; guest_id: string; household_id: string; full_name: string | null };

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
          can_create_wedding: boolean;
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
      cost_centre: { Row: CostCentreRow; Insert: Partial<CostCentreRow>; Update: Partial<CostCentreRow>; Relationships: [] };
      cost_item: { Row: CostItemRow; Insert: Partial<CostItemRow>; Update: Partial<CostItemRow>; Relationships: [] };
      cost_estimate_version: { Row: CostEstimateRow; Insert: Partial<CostEstimateRow>; Update: Partial<CostEstimateRow>; Relationships: [] };
      cost_decision: { Row: CostDecisionRow; Insert: Partial<CostDecisionRow>; Update: Partial<CostDecisionRow>; Relationships: [] };
      cost_commitment: { Row: CostCommitmentRow; Insert: Partial<CostCommitmentRow>; Update: Partial<CostCommitmentRow>; Relationships: [] };
      cost_invoice: { Row: CostInvoiceRow; Insert: Partial<CostInvoiceRow>; Update: Partial<CostInvoiceRow>; Relationships: [] };
      cost_payment: { Row: CostPaymentRow; Insert: Partial<CostPaymentRow>; Update: Partial<CostPaymentRow>; Relationships: [] };
      vendor: { Row: VendorRow; Insert: Partial<VendorRow>; Update: Partial<VendorRow>; Relationships: [] };
      engagement: { Row: EngagementRow; Insert: Partial<EngagementRow>; Update: Partial<EngagementRow>; Relationships: [] };
      guest_dietary_profile: { Row: GuestDietaryProfileRow; Insert: Partial<GuestDietaryProfileRow>; Update: Partial<GuestDietaryProfileRow>; Relationships: [] };
      hotel: { Row: HotelRow; Insert: Partial<HotelRow>; Update: Partial<HotelRow>; Relationships: [] };
      room: { Row: RoomRow; Insert: Partial<RoomRow>; Update: Partial<RoomRow>; Relationships: [] };
      room_allocation: { Row: RoomAllocationRow; Insert: Partial<RoomAllocationRow>; Update: Partial<RoomAllocationRow>; Relationships: [] };
      room_occupant: { Row: RoomOccupantRow; Insert: Partial<RoomOccupantRow>; Update: Partial<RoomOccupantRow>; Relationships: [] };
      stay_request: { Row: StayRequestRow; Insert: Partial<StayRequestRow>; Update: Partial<StayRequestRow>; Relationships: [] };
      travel_detail: { Row: TravelDetailRow; Insert: Partial<TravelDetailRow>; Update: Partial<TravelDetailRow>; Relationships: [] };
      service: { Row: ServiceRow; Insert: Partial<ServiceRow>; Update: Partial<ServiceRow>; Relationships: [] };
      service_request: { Row: ServiceRequestRow; Insert: Partial<ServiceRequestRow>; Update: Partial<ServiceRequestRow>; Relationships: [] };
      stay_activity: { Row: StayActivityRow; Insert: Partial<StayActivityRow>; Update: Partial<StayActivityRow>; Relationships: [] };
      sheet_sync_connection: { Row: SheetSyncConnectionRow; Insert: Partial<SheetSyncConnectionRow>; Update: Partial<SheetSyncConnectionRow>; Relationships: [] };
      sheet_sync_run: { Row: SheetSyncRunRow; Insert: Partial<SheetSyncRunRow>; Update: Partial<SheetSyncRunRow>; Relationships: [] };
      sheet_sync_change: { Row: SheetSyncChangeRow; Insert: Partial<SheetSyncChangeRow>; Update: Partial<SheetSyncChangeRow>; Relationships: [] };
    };
    Views: {
      instance_rsvp_counts: { Row: InstanceRsvpCountsRow; Relationships: [] };
      caterer_report: { Row: CatererReportRow; Relationships: [] };
      directory_entry: { Row: DirectoryEntryRow; Relationships: [] };
      room_occupancy: { Row: RoomOccupancyRow; Relationships: [] };
      stay_summary: { Row: StaySummaryRow; Relationships: [] };
      room_plan: { Row: RoomPlanRow; Relationships: [] };
      room_plan_summary: { Row: RoomPlanSummaryRow; Relationships: [] };
      room_plan_exception: { Row: RoomPlanExceptionRow; Relationships: [] };
      unallocated_stay_guest: { Row: UnallocatedStayGuestRow; Relationships: [] };
      attendance_expanded: { Row: AttendanceExpandedRow; Relationships: [] };
      cost_control_summary: { Row: CostControlSummaryRow; Relationships: [] };
      cost_control_attention: { Row: CostControlAttentionRow; Relationships: [] };
    };
    Functions: {
      current_account_can_create_wedding: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_platform_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      super_admin_set_wedding_creator: {
        Args: { p_email: string; p_enabled: boolean };
        Returns: string;
      };
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
      issue_guest_access_link: {
        Args: { p_actor: string; p_wedding: string; p_guest: string };
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
      save_my_travel: {
        Args: { p_wedding: string; p_guest: string; p_direction: string; p_mode: string | null; p_wall: string | null; p_timezone: string | null; p_carrier: string | null; p_number: string | null; p_from_place: string | null; p_arranged_by: string; p_needs_pickup: boolean; p_luggage_note: string | null };
        Returns: string;
      };
      // Append a Stay & Travel oversight entry (definer, guarded to members of the wedding). Fire-and-forget.
      log_stay_activity: {
        Args: { p_wedding: string; p_action: string; p_summary: string; p_household?: string | null; p_guest?: string | null };
        Returns: undefined;
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
      manage_guest_identity: {
        Args: { p_wedding: string; p_guest: string; p_household: string; p_name: string | null; p_email: string | null; p_directory: boolean };
        Returns: undefined;
      };
      organizer_add_guest: { Args: { p_wedding: string; p_household: string | null; p_new_household: string | null; p_host_group: string | null; p_name: string; p_email: string | null }; Returns: string };
      organizer_invite_guest: { Args: { p_wedding: string; p_guest: string; p_household: string; p_instance: string }; Returns: string };
      owner_create_room_draft: { Args: { p_wedding: string; p_hotel: string; p_provisional: string; p_physical: string | null; p_capacity: number; p_plan: string }; Returns: string };
      owner_update_room_identity: { Args: { p_wedding: string; p_room: string; p_provisional: string; p_physical: string | null; p_capacity: number; p_inventory: string; p_expected_revision: number }; Returns: number };
      owner_save_room_allocation_draft: { Args: { p_wedding: string; p_allocation: string | null; p_room: string; p_primary_household: string | null; p_plan: string; p_guest_ids: string[]; p_check_in: string | null; p_check_out: string | null; p_single_reason: string | null; p_notes: string | null; p_expected_revision: number | null }; Returns: { allocation_id: string; sync_revision: number }[] };
      owner_confirm_room_allocation: { Args: { p_wedding: string; p_allocation: string; p_expected_revision: number }; Returns: number };
      owner_cancel_room_allocation: { Args: { p_wedding: string; p_allocation: string; p_expected_revision: number }; Returns: number };
      owner_configure_room_sheet: { Args: { p_wedding:string; p_spreadsheet_id:string }; Returns:string };
      owner_begin_room_sheet_review: { Args: { p_wedding:string }; Returns:string };
      owner_stage_room_sheet_change: { Args: { p_wedding:string; p_run:string; p_change_key:string; p_allocation:string|null; p_room:string|null; p_base_revision:number; p_proposed:Json }; Returns:string };
      owner_preview_room_sheet_changes: { Args: { p_wedding:string; p_run:string }; Returns:void };
      owner_commit_room_sheet_changes: { Args: { p_wedding:string; p_run:string; p_change_ids:string[] }; Returns:Json };
      // Family-admin: create an event hosted by the caller's own side (0021).
      group_create_event: {
        Args: {
          p_wedding: string; p_host_group: string; p_name: string; p_type: string | null; p_venue: string | null; p_wall: string; p_tz: string | null;
          p_dress?: string | null; p_muhurat_wall?: string | null; p_tithi?: string | null; p_choghadiya?: string | null; p_stream?: string | null;
        };
        Returns: string;
      };
      // Family-admin: edit/cancel an event the caller's side hosts (0021).
      group_update_event: {
        Args: {
          p_wedding: string; p_instance: string; p_name: string | null; p_type: string | null; p_venue: string | null; p_wall: string | null; p_tz: string | null; p_cancelled: boolean;
          p_dress?: string | null; p_muhurat_wall?: string | null; p_tithi?: string | null; p_choghadiya?: string | null; p_stream?: string | null;
        };
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
      owner_assign_wedding_role: { Args: { p_wedding:string; p_email:string; p_role:string }; Returns:string };
      initialize_cost_control: { Args: { p_wedding:string }; Returns:number };
      create_cost_item: { Args: { p_wedding:string; p_centre:string; p_title:string; p_description:string|null; p_event:string|null; p_engagement:string|null; p_decision_due:string|null }; Returns:string };
      save_cost_estimate_draft: { Args: { p_wedding:string; p_item:string; p_estimate:string|null; p_input:Json }; Returns:string };
      submit_cost_estimate: { Args: { p_wedding:string; p_estimate:string }; Returns:undefined };
      begin_cost_review: { Args: { p_wedding:string; p_estimate:string }; Returns:undefined };
      decide_cost_estimate: { Args: { p_wedding:string; p_estimate:string; p_decision:string; p_reason:string; p_expected_state:string }; Returns:undefined };
      propose_cost_commitment: { Args: { p_wedding:string; p_item:string; p_estimate:string; p_engagement:string|null; p_quote_reference:string|null; p_commitment_date:string|null }; Returns:string };
      decide_cost_commitment: { Args: { p_wedding:string; p_commitment:string; p_decision:string; p_reason:string }; Returns:undefined };
      record_cost_invoice: { Args: { p_wedding:string; p_item:string; p_commitment:string|null; p_reference:string; p_subtotal:number; p_tax_rate:number; p_currency:string; p_due_date:string|null }; Returns:string };
      verify_cost_invoice: { Args: { p_wedding:string; p_invoice:string; p_reason:string }; Returns:undefined };
      record_cost_payment: { Args: { p_wedding:string; p_invoice:string; p_amount:number; p_paid_on:string; p_method:string; p_reference:string|null }; Returns:string };
      void_cost_payment: { Args: { p_wedding:string; p_payment:string; p_reason:string }; Returns:undefined };
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
        Returns: { attendance_id: string; row_version: number };
      };
    };
    Enums: EmptyMap;
    CompositeTypes: EmptyMap;
  };
};
