-- 0017_stay_rooms.sql
-- Stay & Travel, layer 1: the hotel room block + the rooming list (which household is in which room, and
-- who the roommates are), with an occupancy view. Owner-only for now; family-admin scoping and the guest
-- self-service surface are later layers (they'll reuse the same tables). Allocation is per HOUSEHOLD with
-- guests as roommates (room_occupant). Logistics only — nightly_rate is stored for a future finance link
-- but nothing here touches finance. Dates are per-household (each allocation carries its own check_in/out).

create type app.room_type   as enum ('single','double','triple','quad','suite');
create type app.stay_status  as enum ('held','confirmed','checked_in','checked_out','cancelled');

-- ---------- the hotel(s) providing the block ----------
create table app.hotel (
  id          uuid not null default gen_random_uuid(),
  wedding_id  uuid not null references app.wedding(id) on delete cascade,
  name        text not null,
  address     text,
  map_url     text,
  notes       text,
  created_at  timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id)
);

-- ---------- a physical room (150 of these = the supply) ----------
create table app.room (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  hotel_id      uuid not null,
  label         text not null,                        -- "204", "Garden Suite"
  room_type     app.room_type not null default 'double',
  capacity      int  not null default 2 check (capacity between 1 and 12),
  floor         text,
  wing          text,
  nightly_rate  numeric(12,2),
  currency      char(3),
  out_of_service boolean not null default false,
  notes         text,
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, hotel_id) references app.hotel (wedding_id, id) on delete cascade
);
create index on app.room (wedding_id, hotel_id);

-- ---------- a household booked into a room for a date range (the rooming list) ----------
create table app.room_allocation (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  room_id      uuid not null,
  household_id uuid not null,
  check_in     date,
  check_out    date,
  status       app.stay_status not null default 'held',
  notes        text,
  created_at   timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, room_id)      references app.room (wedding_id, id) on delete cascade,
  foreign key (wedding_id, household_id) references app.household (wedding_id, id) on delete cascade,
  constraint stay_dates_order check (check_in is null or check_out is null or check_out >= check_in)
);
-- one ACTIVE booking per room, and one active room per household (cancelled ones don't block).
create unique index room_one_active_alloc      on app.room_allocation (wedding_id, room_id)      where status <> 'cancelled';
create unique index household_one_active_alloc on app.room_allocation (wedding_id, household_id)  where status <> 'cancelled';

-- ---------- which specific guests are in the room (the roommates) ----------
create table app.room_occupant (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  allocation_id uuid not null,
  guest_id      uuid not null,
  primary key (id),
  unique (wedding_id, allocation_id, guest_id),
  foreign key (wedding_id, allocation_id) references app.room_allocation (wedding_id, id) on delete cascade,
  foreign key (wedding_id, guest_id)      references app.guest (wedding_id, id) on delete cascade
);
-- a guest can be a roommate in only one ACTIVE allocation (enforced in the trigger below, which also
-- guards capacity — both need to look across rows, which a table CHECK cannot do).
create index on app.room_occupant (wedding_id, allocation_id);

-- Guard: occupants of an allocation must not exceed the room's capacity, and a guest can't be double-booked
-- into two active rooms. Runs on room_occupant insert/update.
create or replace function app.enforce_room_capacity() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_cap int; v_count int; v_status app.stay_status;
begin
  select r.capacity, a.status into v_cap, v_status
    from app.room_allocation a join app.room r on r.wedding_id = a.wedding_id and r.id = a.room_id
   where a.wedding_id = new.wedding_id and a.id = new.allocation_id;
  if v_status = 'cancelled' then
    raise exception 'cannot add a roommate to a cancelled allocation' using errcode = 'SA010';
  end if;
  select count(*) into v_count from app.room_occupant o
    where o.wedding_id = new.wedding_id and o.allocation_id = new.allocation_id and o.id <> new.id;
  if v_count + 1 > v_cap then
    raise exception 'room is full (capacity %)', v_cap using errcode = 'SA011';
  end if;
  if exists (
    select 1 from app.room_occupant o
      join app.room_allocation a on a.wedding_id = o.wedding_id and a.id = o.allocation_id
     where o.wedding_id = new.wedding_id and o.guest_id = new.guest_id and o.id <> new.id
       and a.status <> 'cancelled'
  ) then
    raise exception 'guest is already a roommate in another active room' using errcode = 'SA012';
  end if;
  return new;
end $$;
create trigger room_occupant_guard before insert or update on app.room_occupant
  for each row execute function app.enforce_room_capacity();

-- ---------- occupancy (derived; security_invoker so RLS applies) ----------
create view app.room_occupancy with (security_invoker = true) as
  select r.wedding_id, r.hotel_id, r.id as room_id, r.label, r.room_type, r.capacity, r.out_of_service,
         a.id as allocation_id, a.household_id, a.status,
         coalesce((select count(*) from app.room_occupant o where o.wedding_id = r.wedding_id and o.allocation_id = a.id), 0) as occupants,
         (a.id is not null) as is_occupied
  from app.room r
  left join app.room_allocation a
    on a.wedding_id = r.wedding_id and a.room_id = r.id and a.status <> 'cancelled';

create view app.stay_summary with (security_invoker = true) as
  select r.wedding_id, r.room_type,
         count(*) as total_rooms,
         count(*) filter (where a.id is not null) as occupied_rooms,
         count(*) filter (where a.id is null and not r.out_of_service) as free_rooms,
         count(*) filter (where r.out_of_service) as out_of_service
  from app.room r
  left join app.room_allocation a
    on a.wedding_id = r.wedding_id and a.room_id = r.id and a.status <> 'cancelled'
  group by r.wedding_id, r.room_type;

-- ---------- RLS: owner-only for layer 1 ----------
alter table app.hotel            enable row level security;
alter table app.room             enable row level security;
alter table app.room_allocation  enable row level security;
alter table app.room_occupant    enable row level security;

create policy hotel_owner_all      on app.hotel           for all using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy room_owner_all       on app.room            for all using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy alloc_owner_all      on app.room_allocation for all using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy occ_owner_all        on app.room_occupant   for all using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

grant select, insert, update, delete on app.hotel, app.room, app.room_allocation, app.room_occupant to authenticated;
grant select on app.room_occupancy, app.stay_summary to authenticated;
revoke all on function app.enforce_room_capacity() from public;
