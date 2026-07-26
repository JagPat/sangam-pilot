-- 0018_stay_requests_travel.sql
-- Stay & Travel, layer 2: guest self-service. A household says whether it's staying (stay_request, which
-- also drives the manager's waitlist), and each guest submits their arrival/departure travel (travel_detail)
-- and can see the room they've been given (my_stay). Owner + the guest/proxy only — family-admin scoping is
-- layer 4. The guest sees their room through a SECURITY DEFINER RPC, so no read policies are added to the
-- room tables (they stay owner-only from 0017).

create type app.travel_mode        as enum ('flight','train','car','bus','self');
create type app.travel_dir         as enum ('arrival','departure');
create type app.arranged_by        as enum ('self','host');
create type app.pickup_status      as enum ('none','requested','assigned','done');
create type app.stay_request_status as enum ('needs_room','waitlisted','allocated','declined','cancelled');

-- caller can act for at least one guest in this household (self or proxy)
create or replace function app.can_act_for_household(p_wedding uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.guest g
    where g.wedding_id = p_wedding and g.household_id = p_household and app.can_act_for_guest(g.id)
  );
$$;

-- ---------- a household's stay ask (also the manager's waitlist source) ----------
create table app.stay_request (
  id             uuid not null default gen_random_uuid(),
  wedding_id     uuid not null references app.wedding(id) on delete cascade,
  household_id   uuid not null,
  status         app.stay_request_status not null default 'needs_room',
  party_size     int,
  nights         int,
  arrive_on      date,
  depart_on      date,
  preferred_type app.room_type,
  accessibility  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, household_id),
  foreign key (wedding_id, household_id) references app.household (wedding_id, id) on delete cascade
);

-- ---------- a guest's travel (one row per direction) ----------
create table app.travel_detail (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  guest_id      uuid not null,
  direction     app.travel_dir not null,
  mode          app.travel_mode,
  at_instant    timestamptz,
  carrier       text,
  number        text,
  from_place    text,
  to_place      text,
  arranged_by   app.arranged_by not null default 'self',
  needs_pickup  boolean not null default false,
  pickup_status app.pickup_status not null default 'none',
  luggage_note  text,
  updated_at    timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, guest_id, direction),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id) on delete cascade
);

-- ---------- the guest's own room (read path for "Your stay"; definer, so no room RLS needed) ----------
create or replace function app.my_stay()
returns table (allocation_id uuid, wedding_id uuid, room_label text, room_type text, capacity int,
               hotel_name text, check_in date, check_out date, status text, roommates text[])
language sql stable security definer set search_path = app, public as $$
  select a.id, a.wedding_id, r.label, r.room_type::text, r.capacity, h.name, a.check_in, a.check_out, a.status::text,
         array(select coalesce(g2.full_name,'')
                 from app.room_occupant o2 join app.guest g2 on g2.wedding_id = o2.wedding_id and g2.id = o2.guest_id
                where o2.wedding_id = a.wedding_id and o2.allocation_id = a.id order by g2.full_name)
  from app.room_allocation a
  join app.room r  on r.wedding_id = a.wedding_id and r.id = a.room_id
  join app.hotel h on h.wedding_id = r.wedding_id and h.id = r.hotel_id
  where a.status <> 'cancelled'
    and exists (select 1 from app.room_occupant o join app.guest g on g.wedding_id = o.wedding_id and g.id = o.guest_id
                 where o.wedding_id = a.wedding_id and o.allocation_id = a.id and app.can_act_for_guest(g.id));
$$;

-- ---------- RLS: owner OR the guest/proxy ----------
alter table app.stay_request  enable row level security;
alter table app.travel_detail enable row level security;

create policy stayreq_rw on app.stay_request for all
  using      (app.is_wedding_owner(wedding_id) or app.can_act_for_household(wedding_id, household_id))
  with check (app.is_wedding_owner(wedding_id) or app.can_act_for_household(wedding_id, household_id));

create policy travel_rw on app.travel_detail for all
  using      (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id))
  with check (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));

grant select, insert, update, delete on app.stay_request, app.travel_detail to authenticated;
revoke all on function app.can_act_for_household(uuid, uuid) from public;
revoke all on function app.my_stay() from public;
grant execute on function app.can_act_for_household(uuid, uuid) to authenticated;
grant execute on function app.my_stay() to authenticated;
