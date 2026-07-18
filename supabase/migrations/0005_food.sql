-- 0005_food.sql
-- Single source of truth for dietary/allergy data. Meal eligibility is DERIVED; only explicit
-- overrides are stored. Caterer report is per-instance (per the review, counts are per event).

create type app.dietary_category as enum ('veg','jain','swaminarayan','vaishnav','vegan','nonveg');
create type app.jain_strictness  as enum ('standard','no_root_veg','no_after_sunset','no_honey');

-- the ONLY home for allergy + restriction data
create table app.guest_dietary_profile (
  id             uuid not null default gen_random_uuid(),
  wedding_id     uuid not null references app.wedding(id) on delete cascade,
  guest_id       uuid not null,
  category       app.dietary_category not null,
  jain_strictness app.jain_strictness,
  no_onion_garlic boolean not null default false,
  fasting_days   date[] not null default '{}',
  allergies      text,
  created_at     timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, guest_id),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id),
  constraint jain_strictness_only_for_jain check (jain_strictness is null or category = 'jain')
);

create table app.meal_service (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  event_instance_id uuid not null,
  name              text not null,
  service_at        timestamptz,
  alcohol_available boolean not null default false,
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, event_instance_id) references app.event_instance (wedding_id, id)
);

-- only explicit deviations from derived eligibility are stored (with reason + actor)
create table app.meal_override (
  id               uuid not null default gen_random_uuid(),
  wedding_id       uuid not null references app.wedding(id) on delete cascade,
  meal_service_id  uuid not null,
  guest_id         uuid not null,
  value            text not null,
  reason           text not null,
  actor_account_id uuid,
  at               timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, meal_service_id, guest_id),
  foreign key (wedding_id, meal_service_id) references app.meal_service (wedding_id, id),
  foreign key (wedding_id, guest_id)        references app.guest (wedding_id, id)
);

-- per-instance caterer report: accepted attendees grouped by dietary category.
-- security_invoker=true so it inherits the querier's RLS (no cross-wedding leak via the aggregate).
create view app.caterer_report with (security_invoker = true) as
  select ae.wedding_id, ae.event_instance_id,
         coalesce(d.category::text, 'unknown') as category,
         count(*) as head_count
  from app.attendance_expanded ae
  join app.guest g on g.wedding_id = ae.wedding_id and g.id = ae.guest_id
  left join app.guest_dietary_profile d
    on d.wedding_id = ae.wedding_id and d.guest_id = ae.guest_id
  where ae.status = 'accepted'
  group by ae.wedding_id, ae.event_instance_id, coalesce(d.category::text, 'unknown');

alter table app.guest_dietary_profile enable row level security;
alter table app.meal_service          enable row level security;
alter table app.meal_override         enable row level security;

-- dietary is sensitive: owner, or the guest / their proxy
create policy diet_read on app.guest_dietary_profile for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy diet_self_write on app.guest_dietary_profile for all
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id))
  with check (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
-- meals reveal event detail: scope reads to owner or a guest invited to that instance
create policy meal_read on app.meal_service for select
  using (app.is_wedding_owner(wedding_id) or app.is_invited_to_instance(wedding_id, event_instance_id));
create policy meal_owner_write on app.meal_service for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy moverride_read on app.meal_override for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy moverride_owner_write on app.meal_override for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
