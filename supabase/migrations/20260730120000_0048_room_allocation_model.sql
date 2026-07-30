-- Room planning foundation. Compatibility-first: legacy label/household fields remain readable while
-- explicit room identities and per-guest accommodation requirements become authoritative for new code.

create type app.property_kind as enum ('suryagarh', 'outside');
create type app.property_status as enum ('provisional', 'confirmed');
create type app.room_inventory_status as enum ('provisional', 'confirmed', 'out_of_service');
create type app.occupancy_plan as enum ('single', 'double', 'triple');

alter table app.hotel
  add column property_kind app.property_kind,
  add column property_status app.property_status;

update app.hotel
set property_kind = case when lower(trim(name)) = 'suryagarh' then 'suryagarh'::app.property_kind
                         else 'outside'::app.property_kind end,
    property_status = case when lower(trim(name)) = 'outside suryagarh - tbd' then 'provisional'::app.property_status
                           else 'confirmed'::app.property_status end;

alter table app.hotel
  alter column property_kind set not null,
  alter column property_kind set default 'outside',
  alter column property_status set not null,
  alter column property_status set default 'confirmed';

alter table app.room
  add column provisional_code text,
  add column physical_room_number text,
  add column inventory_status app.room_inventory_status not null default 'provisional',
  add column sync_revision bigint not null default 1,
  add constraint room_sync_revision_positive check (sync_revision > 0);

-- Preserve an unambiguous legacy label. Duplicate labels are replaced with stable migration-only codes;
-- the organizer can later choose human-friendly SUR-/OUT- planning codes without changing room UUIDs.
with labelled as (
  select r.id,
         nullif(trim(r.label), '') as clean_label,
         count(*) over (partition by r.wedding_id, lower(trim(r.label))) as label_count,
         h.property_kind
  from app.room r
  join app.hotel h on h.wedding_id = r.wedding_id and h.id = r.hotel_id
)
update app.room r
set provisional_code = case
  when labelled.clean_label is not null and labelled.label_count = 1 then labelled.clean_label
  else upper(left(labelled.property_kind::text, 3)) || '-MIG-' || replace(r.id::text, '-', '')
end,
inventory_status = case when r.out_of_service then 'out_of_service'::app.room_inventory_status
                        else 'provisional'::app.room_inventory_status end
from labelled
where labelled.id = r.id;

alter table app.room alter column provisional_code set not null;
create unique index room_provisional_code_wedding_unique
  on app.room (wedding_id, lower(trim(provisional_code)));
create unique index room_physical_number_property_unique
  on app.room (wedding_id, hotel_id, lower(trim(physical_room_number)))
  where physical_room_number is not null and trim(physical_room_number) <> '';

create or replace function app.fill_room_provisional_code() returns trigger
language plpgsql set search_path = app, public as $$
begin
  if nullif(trim(new.provisional_code), '') is null then
    if nullif(trim(new.label), '') is null then
      raise exception 'a provisional room code is required' using errcode = 'SR001';
    end if;
    new.provisional_code := trim(new.label);
  else
    new.provisional_code := trim(new.provisional_code);
  end if;
  new.physical_room_number := nullif(trim(new.physical_room_number), '');
  return new;
end;
$$;
create trigger room_fill_provisional_code
  before insert or update of label, provisional_code, physical_room_number on app.room
  for each row execute function app.fill_room_provisional_code();
revoke all on function app.fill_room_provisional_code() from public, anon, authenticated;

alter table app.room_allocation
  add column primary_household_id uuid,
  add column occupancy_plan app.occupancy_plan,
  add column single_occupancy_exception_reason text,
  add column sharing_confirmed_at timestamptz,
  add column sharing_confirmed_by uuid references app.account(id) on delete set null,
  add column sharing_confirmed_revision bigint,
  add column sync_revision bigint not null default 1,
  add constraint allocation_sync_revision_positive check (sync_revision > 0),
  add constraint allocation_confirmation_revision check (
    (sharing_confirmed_at is null and sharing_confirmed_by is null and sharing_confirmed_revision is null)
    or
    (sharing_confirmed_at is not null and sharing_confirmed_by is not null and sharing_confirmed_revision is not null)
  );

update app.room_allocation a
set primary_household_id = a.household_id,
    occupancy_plan = case r.room_type
      when 'single' then 'single'::app.occupancy_plan
      when 'triple' then 'triple'::app.occupancy_plan
      else 'double'::app.occupancy_plan
    end
from app.room r
where r.wedding_id = a.wedding_id and r.id = a.room_id;

alter table app.room_allocation
  alter column occupancy_plan set not null,
  alter column occupancy_plan set default 'double',
  alter column household_id drop not null,
  add constraint allocation_primary_household_fk
    foreign key (wedding_id, primary_household_id)
    references app.household(wedding_id, id) on delete set null;

drop index app.household_one_active_alloc;

alter table app.stay_request
  add constraint stay_request_wedding_id_unique unique (wedding_id, id);

create table app.stay_request_guest (
  id uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  stay_request_id uuid not null,
  guest_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  unique (wedding_id, stay_request_id, guest_id),
  foreign key (wedding_id, stay_request_id) references app.stay_request(wedding_id, id) on delete cascade,
  foreign key (wedding_id, guest_id) references app.guest(wedding_id, id) on delete cascade
);
create index stay_request_guest_by_guest on app.stay_request_guest(wedding_id, guest_id);

alter table app.stay_request_guest enable row level security;
create policy stay_request_guest_owner_or_actor on app.stay_request_guest for all
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id))
  with check (
    (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id))
    and exists (
      select 1 from app.stay_request sr
      join app.guest g on g.wedding_id = sr.wedding_id and g.id = stay_request_guest.guest_id
      where sr.wedding_id = stay_request_guest.wedding_id
        and sr.id = stay_request_guest.stay_request_id
        and g.household_id = sr.household_id
    )
  );
create policy stay_request_guest_group_admin_read on app.stay_request_guest for select
  using (app.can_admin_guest(wedding_id, guest_id));

grant select, insert, delete on app.stay_request_guest to authenticated;
