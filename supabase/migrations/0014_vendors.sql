-- 0014_vendors.sql
-- Vendor coordination (module M9): the people who PROVIDE the wedding — performers, band, DJ, hair, make-up,
-- décor, catering — as a small draft workspace that the owner runs, and whose CONFIRMED engagements surface
-- to guests as the "Performing" line on the event card. Purely additive (new tables + one read function);
-- nothing existing changes, so the currently deployed app is unaffected.
--
-- v1 model: a `vendor` profile + an `engagement` (one booking's journey through a small state machine, linked
-- to the event it serves). The quote lives on the engagement (a full quote-history table can come later).
-- The organizer manages both directly under owner RLS (like host_group); guests never read these tables —
-- they see only confirmed performers, through the SECURITY DEFINER read at the bottom.

create type app.vendor_category as enum
  ('music','dj','band','mc','hair','makeup','decor','florist','catering','photo','transport','pandit','other');

create type app.engagement_state as enum
  ('shortlisted','inquired','quoted','confirmed','declined','cancelled');

create table app.vendor (
  id           uuid not null default gen_random_uuid(),
  wedding_id   uuid not null references app.wedding(id) on delete cascade,
  category     app.vendor_category not null default 'other',
  name         text not null,
  contact_name text,
  email        text,
  phone        text,
  host_group_id uuid,                                    -- whose side sources them (optional)
  notes        text,
  created_at   timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, host_group_id) references app.host_group (wedding_id, id)
);

create table app.engagement (
  id                uuid not null default gen_random_uuid(),
  wedding_id        uuid not null references app.wedding(id) on delete cascade,
  vendor_id         uuid not null,
  event_instance_id uuid,                                -- the function they serve (null until scheduled)
  state             app.engagement_state not null default 'shortlisted',
  role_title        text,                                -- e.g. 'DJ', 'Live band'
  blurb             text,                                -- one line shown to guests ("Bollywood & house · 200+ weddings")
  quote_amount      numeric(14,2),
  quote_currency    char(3),
  notes             text,                                -- internal organizer notes
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, id),
  foreign key (wedding_id, vendor_id)         references app.vendor (wedding_id, id) on delete cascade,
  foreign key (wedding_id, event_instance_id) references app.event_instance (wedding_id, id),
  constraint eng_currency_iso check (quote_currency is null or quote_currency ~ '^[A-Z]{3}$'),
  constraint eng_amount_pos    check (quote_amount is null or quote_amount >= 0)
);

create index engagement_by_instance on app.engagement (wedding_id, event_instance_id) where state = 'confirmed';

-- deny-by-default; owner manages both directly (mirrors host_group). Guests never read these.
alter table app.vendor     enable row level security;
alter table app.engagement enable row level security;

create policy vendor_owner_all on app.vendor for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy engagement_owner_all on app.engagement for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- grants: authenticated may read/write, RLS scopes every row to the wedding owner.
grant select, insert, update, delete on app.vendor     to authenticated;
grant select, insert, update, delete on app.engagement to authenticated;

-- The only guest-facing read: confirmed performers for the events the caller is invited to. SECURITY DEFINER
-- so it can look past the owner-only RLS on vendor/engagement, but gated by is_invited_to_instance so a guest
-- only ever sees performers for their own events — never the vendor list, quotes, or notes.
create or replace function app.my_event_performers()
returns table(event_instance_id uuid, vendor_name text, role_title text, blurb text)
language sql stable security definer set search_path = app, public as $$
  select e.event_instance_id, v.name, e.role_title, e.blurb
  from app.engagement e
  join app.vendor v on v.id = e.vendor_id
  where e.state = 'confirmed'
    and e.event_instance_id is not null
    and app.is_invited_to_instance(e.wedding_id, e.event_instance_id)
  order by v.name;
$$;
revoke execute on function app.my_event_performers() from public, anon;
grant  execute on function app.my_event_performers() to authenticated;
