-- 0003_schedule.sql
-- Schedule: function grouping + attendable instances. Preserves ORIGINAL wall time + offset for every
-- important time (zoned_time), constrains muhurat (incl. rejecting start/end when kind is null),
-- and separates scheduled lifecycle from live operational state.

-- reusable time value: keep the instant AND the original human input
create type app.zoned_time as (
  instant        timestamptz,
  wall_local     timestamp,     -- what the priest/host actually entered
  offset_minutes integer,       -- the chosen UTC offset at entry
  source         text           -- 'priest' | 'host' | 'import'
);

create type app.muhurat_kind    as enum ('instant','window');
create type app.event_live_state as enum ('not_started','boarding','in_progress','delayed','completed');
create type app.scheduled_status as enum ('scheduled','cancelled');

create table app.venue (
  id            uuid not null default gen_random_uuid(),
  wedding_id    uuid not null references app.wedding(id) on delete cascade,
  name          text not null,
  address       text,
  lat           double precision,
  lng           double precision,
  iana_timezone text not null,
  map_url       text,
  primary key (id),
  unique (wedding_id, id)
);

create table app.event_function (             -- grouping WITHIN this wedding (not a cross-wedding template)
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  name       text not null,
  type       text not null,                   -- pithi | haldi | mehndi | sangeet | ceremony | ...
  primary key (id),
  unique (wedding_id, id)
);

create table app.event_instance (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  event_function_id uuid not null,
  venue_id          uuid,
  iana_timezone     text not null,
  arrival           app.zoned_time not null,
  ceremony_start    app.zoned_time,
  muhurat_kind      app.muhurat_kind,
  muhurat_start     app.zoned_time,
  muhurat_end       app.zoned_time,
  muhurat_source_note text,
  choghadiya_text   text,
  tithi_text        text,
  dress_code        text,
  alcohol_available boolean not null default false,
  scheduled_status  app.scheduled_status not null default 'scheduled',
  stream_url        text,
  entry_source      text,
  time_confirmed_by uuid,
  time_confirmed_at timestamptz,
  created_at        timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, event_function_id) references app.event_function (wedding_id, id),
  foreign key (wedding_id, venue_id)          references app.venue (wedding_id, id),
  -- CASE (not OR-of-comparisons): an enum comparison against a NULL kind yields NULL, and a CHECK
  -- treats NULL as satisfied — which would let a malformed row through. CASE returns a hard boolean.
  constraint muhurat_shape check (
    case
      when muhurat_kind is null      then (muhurat_start is null and muhurat_end is null)
      when muhurat_kind = 'instant'  then (muhurat_start is not null and muhurat_end is null)
      when muhurat_kind = 'window'   then (muhurat_start is not null and muhurat_end is not null
                                           and (muhurat_end).instant > (muhurat_start).instant)
      else false
    end
  ),
  -- zoned_time coherence (a composite type can't self-validate, so validate at the table):
  constraint arrival_valid   check ((arrival).instant is not null and (arrival).offset_minutes between -720 and 840),
  constraint ceremony_valid  check (ceremony_start is null or (ceremony_start).instant is not null),
  constraint muhurat_instants check ((muhurat_start is null or (muhurat_start).instant is not null)
                                     and (muhurat_end is null or (muhurat_end).instant is not null))
);

create table app.event_host_group (            -- junction carries wedding_id (scoping invariant)
  wedding_id       uuid not null references app.wedding(id) on delete cascade,
  event_instance_id uuid not null,
  host_group_id    uuid not null,
  primary key (wedding_id, event_instance_id, host_group_id),
  foreign key (wedding_id, event_instance_id) references app.event_instance (wedding_id, id),
  foreign key (wedding_id, host_group_id)     references app.host_group (wedding_id, id)
);

create table app.event_live_status (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  event_instance_id uuid not null,
  state             app.event_live_state not null,
  effective_at      timestamptz,
  expires_at        timestamptz,
  set_by            uuid,
  set_at            timestamptz not null default now(),
  primary key (id),
  foreign key (wedding_id, event_instance_id) references app.event_instance (wedding_id, id)
);

create table app.event_help_contact (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  event_instance_id uuid,
  host_group_id     uuid,
  name              text not null,
  channel           text not null,
  value             text not null,
  primary key (id),
  foreign key (wedding_id, event_instance_id) references app.event_instance (wedding_id, id),
  foreign key (wedding_id, host_group_id)     references app.host_group (wedding_id, id)
);

-- schedule revision + acknowledgement (distinct from content publication_revision in 0006)
create table app.schedule_revision (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  version      integer not null,
  note         text,
  published_at timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  unique (wedding_id, version)
);
create table app.schedule_acknowledgement (
  id                   uuid not null default gen_random_uuid(),
  wedding_id           uuid not null references app.wedding(id) on delete cascade,
  guest_id             uuid not null,
  schedule_revision_id uuid not null,
  acknowledged_at      timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, guest_id, schedule_revision_id),
  foreign key (wedding_id, guest_id)             references app.guest (wedding_id, id),
  foreign key (wedding_id, schedule_revision_id) references app.schedule_revision (wedding_id, id)
);

-- effective state = live override (if active) else scheduled
create or replace function app.effective_event_state(p_wedding uuid, p_instance uuid) returns text
language sql stable security definer set search_path = app, public as $$
  with live as (
    select state::text from app.event_live_status
    where wedding_id = p_wedding and event_instance_id = p_instance
      and (expires_at is null or expires_at > now())
    order by set_at desc limit 1
  )
  select coalesce((select state from live),
                  (select scheduled_status::text from app.event_instance
                   where wedding_id = p_wedding and id = p_instance));
$$;

-- deny-by-default RLS
alter table app.venue                  enable row level security;
alter table app.event_function         enable row level security;
alter table app.event_instance         enable row level security;
alter table app.event_host_group       enable row level security;
alter table app.event_live_status      enable row level security;
alter table app.event_help_contact     enable row level security;
alter table app.schedule_revision      enable row level security;
alter table app.schedule_acknowledgement enable row level security;

-- reusable predicate: the current user is invited to this instance (via a guest they can act for).
-- plpgsql (not sql) so the body isn't validated at CREATE time — invitation_guest is created in 0004.
create or replace function app.is_invited_to_instance(p_wedding uuid, p_instance uuid) returns boolean
language plpgsql stable security definer set search_path = app, public as $$
begin
  return exists (
    select 1 from app.invitation_guest ig
    where ig.wedding_id = p_wedding and ig.event_instance_id = p_instance and app.can_act_for_guest(ig.guest_id)
  );
end $$;

-- event_instance: owner, or a guest invited to THIS instance. NOT member-wide (fixes uninvited-event read).
create policy einst_read on app.event_instance for select
  using (app.is_wedding_owner(wedding_id) or app.is_invited_to_instance(wedding_id, id));
create policy einst_owner_write on app.event_instance for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy efunc_read on app.event_function for select using (
  app.is_wedding_owner(wedding_id)
  or exists (select 1 from app.event_instance i
             where i.wedding_id = event_function.wedding_id and i.event_function_id = event_function.id
               and app.is_invited_to_instance(i.wedding_id, i.id)));
create policy efunc_owner_write on app.event_function for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy venue_read on app.venue for select using (
  app.is_wedding_owner(wedding_id)
  or exists (select 1 from app.event_instance i
             where i.wedding_id = venue.wedding_id and i.venue_id = venue.id
               and app.is_invited_to_instance(i.wedding_id, i.id)));
create policy venue_owner_write on app.venue for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy elive_read on app.event_live_status for select
  using (app.is_wedding_owner(wedding_id) or app.is_invited_to_instance(wedding_id, event_instance_id));
create policy elive_owner_write on app.event_live_status for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy ehg_read on app.event_host_group for select
  using (app.is_wedding_owner(wedding_id) or app.is_invited_to_instance(wedding_id, event_instance_id));
create policy ehg_owner_write on app.event_host_group for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy ehelp_read on app.event_help_contact for select using (
  app.is_wedding_owner(wedding_id)
  or (event_instance_id is not null and app.is_invited_to_instance(wedding_id, event_instance_id))
  or (event_instance_id is null and app.is_member(wedding_id)));
create policy ehelp_owner_write on app.event_help_contact for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy srev_read on app.schedule_revision for select using (app.is_member(wedding_id));
create policy srev_owner_write on app.schedule_revision for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- schedule acknowledgement: the guest/proxy inserts their own; owner reads all
create policy sack_read on app.schedule_acknowledgement for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy sack_self_insert on app.schedule_acknowledgement for insert
  with check (app.can_act_for_guest(guest_id));
