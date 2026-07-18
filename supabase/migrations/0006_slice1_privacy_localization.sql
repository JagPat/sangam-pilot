-- 0006_slice1_privacy_localization.sql
-- MINIMAL Slice-1 privacy/localization boundary ONLY: content + notice/consent (single subject) +
-- guardian is in 0002 + append-only audit + retention POLICY (not execution jobs).
-- Deferred (NOT here): assistance_request, data_retention_job execution, outbox/consent-at-send.

create type app.content_status     as enum ('draft','reviewed','published');
create type app.translation_status as enum ('draft','reviewed','published','stale');
create type app.consent_purpose    as enum ('whatsapp','ai_processing','directory','photos','assistance');
create type app.audit_action       as enum ('rsvp','delegation','event','consent','export','import','role');

-- ---------- content + localization (versioned; visible source-language fallback) ----------
create table app.content_item (
  id             uuid not null default gen_random_uuid(),
  wedding_id     uuid not null references app.wedding(id) on delete cascade,
  kind           text not null,                     -- 'ritual_explainer' | 'info_hub' | ...
  owner_account_id uuid,
  source         text,
  status         app.content_status not null default 'draft',
  last_verified_at timestamptz,
  freeze_deadline timestamptz,
  primary key (id),
  unique (wedding_id, id)
);
create table app.content_translation (
  id             uuid not null default gen_random_uuid(),
  wedding_id     uuid not null references app.wedding(id) on delete cascade,
  content_item_id uuid not null,
  language       app.language not null,
  source_version integer not null,                  -- goes 'stale' when the source moves past this
  body           text not null,
  status         app.translation_status not null default 'draft',
  primary key (id),
  unique (wedding_id, content_item_id, language),
  foreign key (wedding_id, content_item_id) references app.content_item (wedding_id, id)
);
create table app.translation_review (
  id                    uuid not null default gen_random_uuid(),
  wedding_id            uuid not null references app.wedding(id) on delete cascade,
  content_translation_id uuid not null,
  reviewer_account_id   uuid,
  decision              text not null,
  at                    timestamptz not null default now(),
  foreign key (content_translation_id) references app.content_translation (id)
);
create table app.publication_revision (             -- CONTENT revision (distinct from schedule_revision)
  id              uuid not null default gen_random_uuid(),
  wedding_id      uuid not null references app.wedding(id) on delete cascade,
  content_item_id uuid not null,
  version         integer not null,
  published_at    timestamptz not null default now(),
  primary key (id),
  unique (wedding_id, content_item_id, version),
  foreign key (wedding_id, content_item_id) references app.content_item (wedding_id, id)
);

-- ---------- consent / notice / preference are THREE DISTINCT concepts ----------
create table app.consent_record (
  id                 uuid not null default gen_random_uuid(),
  wedding_id         uuid not null references app.wedding(id) on delete cascade,
  guest_id           uuid not null,                 -- single subject type
  recorded_by_account_id uuid,
  purpose            app.consent_purpose not null,
  version            integer not null,
  granted            boolean not null,
  at                 timestamptz not null default now(),
  withdrawn_at       timestamptz,
  primary key (id),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id)
);
create table app.notice_acknowledgement (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  guest_id   uuid not null,
  notice_id  text not null,
  version    integer not null,
  at         timestamptz not null default now(),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id)
);
create table app.operational_preference (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  guest_id   uuid not null,
  key        text not null,
  value      text not null,
  set_by     uuid,
  unique (wedding_id, guest_id, key),
  primary key (id),
  foreign key (wedding_id, guest_id) references app.guest (wedding_id, id)
);

-- ---------- append-only audit ----------
create table app.audit_event (
  id               uuid not null default gen_random_uuid(),
  wedding_id       uuid not null references app.wedding(id) on delete cascade,
  actor_account_id uuid,
  action           app.audit_action not null,
  target_ref       text,                             -- identifier only
  channel          app.rsvp_channel,                 -- STRUCTURED provenance for action='rsvp' (null otherwise)
  authority        app.rsvp_authority,               -- STRUCTURED provenance for action='rsvp' (null otherwise)
  safe_summary     text,                             -- NO allergy/contact/chandlo copies (human echo only)
  at               timestamptz not null default now(),
  primary key (id),
  -- an RSVP audit row ALWAYS carries structured provenance, so reports query/aggregate typed columns
  -- instead of parsing safe_summary text.
  constraint audit_rsvp_provenance check (action <> 'rsvp' or (channel is not null and authority is not null))
);
-- Append-only is enforced by PRIVILEGE, not a trigger: 0007 REVOKEs UPDATE/DELETE on audit_event from
-- anon/authenticated, so app users can never tamper. (A hard BEFORE DELETE trigger would deadlock the
-- `wedding ... on delete cascade` path — deleting a wedding would fail on its audit rows. Retention/
-- wedding deletion is a service_role/superuser operation.)

-- ---------- retention POLICY (source of truth; execution jobs are a later fast-follow) ----------
create table app.retention_policy (
  id         uuid not null default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  scope      text not null,                          -- 'contacts' | 'transcripts' | 'assistance' | ...
  rule       text not null,                          -- 'delete' | 'anonymize' | 'retain'
  ttl_days   integer,
  version    integer not null default 1,
  primary key (id),
  unique (wedding_id, scope, version)
);

alter table app.content_item          enable row level security;
alter table app.content_translation   enable row level security;
alter table app.translation_review    enable row level security;
alter table app.publication_revision  enable row level security;
alter table app.consent_record        enable row level security;
alter table app.notice_acknowledgement enable row level security;
alter table app.operational_preference enable row level security;
alter table app.audit_event           enable row level security;
alter table app.retention_policy      enable row level security;

-- content: members read ONLY published items; owner manages all
create policy content_published_read on app.content_item for select
  using (app.is_member(wedding_id) and status = 'published');
create policy content_owner_all on app.content_item for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy ctrans_published_read on app.content_translation for select using (
  app.is_member(wedding_id) and status = 'published'
  and exists (select 1 from app.content_item ci
              where ci.wedding_id = content_translation.wedding_id and ci.id = content_translation.content_item_id
                and ci.status = 'published'));
create policy ctrans_owner_all on app.content_translation for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

create policy trev_owner_all on app.translation_review for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
create policy pubrev_member_read on app.publication_revision for select using (app.is_member(wedding_id));
create policy pubrev_owner_write on app.publication_revision for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));

-- consent / notice / preference: the guest (or proxy) self-serves; owner may read
create policy consent_read on app.consent_record for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy consent_write on app.consent_record for insert
  with check (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy notice_read on app.notice_acknowledgement for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy notice_self_insert on app.notice_acknowledgement for insert
  with check (app.can_act_for_guest(guest_id));
create policy pref_read on app.operational_preference for select
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));
create policy pref_self_write on app.operational_preference for all
  using (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id))
  with check (app.is_wedding_owner(wedding_id) or app.can_act_for_guest(guest_id));

create policy audit_owner_select on app.audit_event for select using (app.is_wedding_owner(wedding_id));
create policy retention_owner_all on app.retention_policy for all
  using (app.is_wedding_owner(wedding_id)) with check (app.is_wedding_owner(wedding_id));
