-- 0019_services.sql
-- Stay & Travel, layer 3: hotel / add-on services with a "who pays" model. Each service the host lists is
-- tagged with a billing tier: 'included' (host bulk-buys / offers it free to the guest), 'allowance' (host
-- covers up to included_qty per person/household, the guest pays for the overage), or 'guest_paid' (the guest
-- buys it entirely on their own behalf). That one flag segregates the guest menu ("Included with your stay"
-- vs "Add at your own cost"), decides whether a price is shown, and decides whose money it is. Payment itself
-- is OFF-PLATFORM for the pilot — Sangam records the charge and its settlement state; the guest actually pays
-- at the desk / on their hotel folio / via a vendor link. No card handling here.
--
-- Reuses the existing scoping helpers (is_member, is_wedding_owner, can_act_for_guest, can_act_for_household),
-- so there is no new SECURITY DEFINER surface and no RLS recursion. Owner defines the catalogue; members read
-- it; a guest (or their household proxy) creates and manages only their own requests.

create type app.service_billing    as enum ('included','allowance','guest_paid');
create type app.service_scope      as enum ('per_person','per_household');
create type app.service_req_status as enum ('requested','confirmed','declined','delivered','cancelled');
create type app.settle_status      as enum ('none','due','settled','waived');
create type app.settle_via         as enum ('hotel_folio','front_desk','vendor_link','cash');

-- ---------- the host's service catalogue ----------
create table app.service (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  name         text not null,
  description  text,
  category     text,                                   -- free text: transport / wellness / food / room / experience
  billing      app.service_billing not null default 'guest_paid',
  price_cents  int  not null default 0,                -- minor units (paise). Meaning depends on billing:
                                                       --   included  → the host's unit cost (guest sees free)
                                                       --   allowance → the price the guest pays per overage unit
                                                       --   guest_paid→ the price the guest pays per unit
  currency     text not null default 'INR',
  unit_label   text,                                   -- display only: "per night", "per treatment", "per person"
  included_qty int,                                    -- allowance only: units included free (per `scope`)
  scope        app.service_scope not null default 'per_person',  -- per person (guest picks) or per household
  settle_hint  app.settle_via not null default 'front_desk',     -- how the guest-paid portion settles, off-platform
  capacity     int,                                    -- optional total inventory cap; null = unlimited
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id),
  constraint service_price_nonneg check (price_cents >= 0),
  constraint service_allowance_qty check (
    (billing = 'allowance' and included_qty is not null and included_qty > 0)
    or (billing <> 'allowance')
  )
);
create index service_by_wedding on app.service (wedding_id, active, sort_order);

-- ---------- a guest's / household's request against a service ----------
create table app.service_request (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  service_id   uuid not null references app.service(id) on delete cascade,
  household_id uuid not null,
  guest_id     uuid,                                   -- null ⇒ a household-level request (per_household service)
  qty          int not null default 1,
  status       app.service_req_status not null default 'requested',
  settle       app.settle_status not null default 'none',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id),
  constraint service_req_qty check (qty > 0),
  foreign key (wedding_id, household_id) references app.household (wedding_id, id) on delete cascade,
  foreign key (wedding_id, guest_id)     references app.guest (wedding_id, id) on delete cascade
);
-- one live request per (service, person) and per (service, household-level ask) — guests adjust qty, not dupe
create unique index service_req_one_active_person on app.service_request (wedding_id, service_id, guest_id)
  where guest_id is not null and status <> 'cancelled';
create unique index service_req_one_active_hh on app.service_request (wedding_id, service_id, household_id)
  where guest_id is null and status <> 'cancelled';
create index service_req_by_service on app.service_request (wedding_id, service_id);
create index service_req_by_household on app.service_request (wedding_id, household_id);

-- ---------- RLS ----------
alter table app.service         enable row level security;
alter table app.service_request enable row level security;

-- catalogue: any member of the wedding can read the menu; only the owner may create/edit/remove items
create policy service_read on app.service for select
  using (app.is_member(wedding_id) or app.is_wedding_owner(wedding_id));
create policy service_write on app.service for all
  using      (app.is_wedding_owner(wedding_id))
  with check (app.is_wedding_owner(wedding_id));

-- requests: the owner sees/settles all; a guest (or their household proxy) only their own
create policy servreq_rw on app.service_request for all
  using (
    app.is_wedding_owner(wedding_id)
    or (guest_id is not null and app.can_act_for_guest(guest_id))
    or (guest_id is null     and app.can_act_for_household(wedding_id, household_id))
  )
  with check (
    app.is_wedding_owner(wedding_id)
    or (guest_id is not null and app.can_act_for_guest(guest_id))
    or (guest_id is null     and app.can_act_for_household(wedding_id, household_id))
  );

grant select, insert, update, delete on app.service         to authenticated;
grant select, insert, update, delete on app.service_request to authenticated;
