-- Recovered verbatim from the production migration history on 2026-07-26.
create or replace function app.owner_commit_guest_import(p_wedding uuid, p_batch uuid)
returns int language plpgsql security definer set search_path = app, public as $$
declare
  r record; v_side text; v_kind app.host_group_kind; v_group uuid; v_hh uuid; v_guest uuid;
  v_name text; v_hhname text; v_email text; v_phone text; v_count int := 0;
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  if not exists (select 1 from app.guest_import_batch b
                 where b.wedding_id = p_wedding and b.id = p_batch and b.status = 'pending') then
    raise exception 'import batch not found or already processed';
  end if;

  for r in select * from app.guest_import_row
           where wedding_id = p_wedding and batch_id = p_batch and status = 'parsed' order by id loop
    v_name := nullif(btrim(coalesce(r.raw->>'full_name','')), '');
    if v_name is null then
      update app.guest_import_row set status = 'error', error = 'missing full name' where id = r.id;
      continue;
    end if;

    v_side := lower(btrim(coalesce(r.raw->>'side','')));
    if    v_side like 'bride%' then v_kind := 'bride_family';
    elsif v_side like 'groom%' then v_kind := 'groom_family';
    else  v_kind := 'mutual'; end if;
    if v_kind = 'mutual' then v_group := null;
    else select id into v_group from app.host_group where wedding_id = p_wedding and kind = v_kind limit 1; end if;

    v_hhname := coalesce(nullif(btrim(coalesce(r.raw->>'household','')), ''), v_name);
    v_hh := null;
    select id into v_hh from app.household
      where wedding_id = p_wedding and lower(btrim(name)) = lower(v_hhname)
        and host_group_id is not distinct from v_group
      limit 1;
    if v_hh is null then
      insert into app.household(wedding_id, name, host_group_id) values (p_wedding, v_hhname, v_group)
      returning id into v_hh;
    end if;

    insert into app.guest(wedding_id, household_id, full_name, side_default, relationship_label, kinship_term, is_minor, show_in_directory)
    values (
      p_wedding, v_hh, v_name, v_kind,
      nullif(btrim(coalesce(r.raw->>'relationship','')), ''),
      nullif(btrim(coalesce(r.raw->>'kinship','')), ''),
      (lower(coalesce(r.raw->>'minor','')) like 'y%'),
      (lower(coalesce(r.raw->>'directory','yes')) not like 'n%')
    ) returning id into v_guest;

    v_email := lower(nullif(btrim(coalesce(r.raw->>'email','')), ''));
    if v_email is not null and not exists (
        select 1 from app.household_contact c where c.wedding_id = p_wedding and c.household_id = v_hh
          and c.channel = 'email' and lower(c.value) = v_email) then
      insert into app.household_contact(wedding_id, household_id, guest_id, channel, value, is_shared)
      values (p_wedding, v_hh, v_guest, 'email', v_email, false);
    end if;
    v_phone := nullif(btrim(coalesce(r.raw->>'phone','')), '');
    if v_phone is not null and not exists (
        select 1 from app.household_contact c where c.wedding_id = p_wedding and c.household_id = v_hh
          and c.channel = 'whatsapp' and c.value = v_phone) then
      insert into app.household_contact(wedding_id, household_id, guest_id, channel, value, is_shared)
      values (p_wedding, v_hh, v_guest, 'whatsapp', v_phone, false);
    end if;

    update app.guest_import_row set status = 'applied', resolved_guest_id = v_guest where id = r.id;
    v_count := v_count + 1;
  end loop;

  update app.guest_import_batch set status = 'committed' where wedding_id = p_wedding and id = p_batch;
  return v_count;
end $$;

create or replace function app.owner_discard_guest_import(p_wedding uuid, p_batch uuid)
returns void language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding'; end if;
  delete from app.guest_import_row   where wedding_id = p_wedding and batch_id = p_batch;
  delete from app.guest_import_batch where wedding_id = p_wedding and id = p_batch;
end $$;

grant select, insert, update, delete on app.guest_import_batch to authenticated;
grant select, insert, update, delete on app.guest_import_row   to authenticated;

revoke execute on function app.owner_commit_guest_import(uuid, uuid)  from public, anon;
grant  execute on function app.owner_commit_guest_import(uuid, uuid)  to authenticated;
revoke execute on function app.owner_discard_guest_import(uuid, uuid) from public, anon;
grant  execute on function app.owner_discard_guest_import(uuid, uuid) to authenticated;
