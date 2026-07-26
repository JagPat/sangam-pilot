-- Bind every service request to one wedding and to a subject that matches the
-- service scope. RLS alone cannot protect composite identifiers supplied in one row.
alter table app.service add constraint service_wedding_id_unique unique (wedding_id,id);
alter table app.guest add constraint guest_wedding_household_id_unique unique (wedding_id,household_id,id);

alter table app.service_request
  drop constraint service_request_service_id_fkey,
  add constraint service_request_service_wedding_fk
    foreign key (wedding_id,service_id) references app.service(wedding_id,id) on delete cascade,
  drop constraint service_request_wedding_id_guest_id_fkey,
  add constraint service_request_guest_household_fk
    foreign key (wedding_id,household_id,guest_id)
    references app.guest(wedding_id,household_id,id) on delete cascade;

alter table app.service add constraint service_currency_iso check (currency ~ '^[A-Z]{3}$');

create or replace function app.enforce_service_request_scope() returns trigger
language plpgsql set search_path=app,public as $$
declare v_scope app.service_scope;
begin
  select s.scope into strict v_scope
    from app.service s where s.wedding_id=new.wedding_id and s.id=new.service_id;
  if v_scope='per_person' and new.guest_id is null then
    raise exception 'per-person service requires a guest' using errcode='23514';
  end if;
  if v_scope='per_household' and new.guest_id is not null then
    raise exception 'per-household service must not identify a guest' using errcode='23514';
  end if;
  return new;
end $$;

create trigger service_request_scope_guard
before insert or update of wedding_id,service_id,household_id,guest_id on app.service_request
for each row execute function app.enforce_service_request_scope();

revoke execute on function app.enforce_service_request_scope() from public,anon,authenticated;
