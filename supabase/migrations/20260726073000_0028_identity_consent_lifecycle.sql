-- Directory presence is explicit opt-in. Missing consent must fail closed.
alter table app.guest alter column show_in_directory set default false;
update app.guest g set show_in_directory=false
 where not exists (
   select 1 from app.directory_consent dc
    where dc.wedding_id=g.wedding_id and dc.guest_id=g.id
      and dc.field='name' and dc.visible=true
 );

create or replace view app.directory_entry with (security_invoker=false) as
  select g.wedding_id,g.id as guest_id,g.full_name,g.relationship_label,g.kinship_term,
         g.side_default,g.name_pronunciation_clip_url
    from app.guest g
   where g.show_in_directory and app.is_member(g.wedding_id)
     and exists (
       select 1 from app.directory_consent dc
        where dc.wedding_id=g.wedding_id and dc.guest_id=g.id
          and dc.field='name' and dc.visible=true
     );

create or replace function app.revoke_membership_if_unreferenced(p_wedding uuid,p_account uuid)
returns void language plpgsql security definer set search_path=app,public as $$
begin
  if p_account is null then return; end if;
  if exists(select 1 from app.operator_role where wedding_id=p_wedding and account_id=p_account)
    or exists(select 1 from app.guest where wedding_id=p_wedding and self_account_id=p_account)
    or exists(select 1 from app.guest_delegation where wedding_id=p_wedding and account_id=p_account and revoked_at is null and (expires_at is null or expires_at>now()))
    or exists(select 1 from app.captain_assignment where wedding_id=p_wedding and account_id=p_account)
    or exists(select 1 from app.guardian_assignment where wedding_id=p_wedding and guardian_account_id=p_account)
  then return; end if;
  update app.wedding_membership set status='revoked'
   where wedding_id=p_wedding and account_id=p_account and status<>'revoked';
end $$;

revoke execute on function app.revoke_membership_if_unreferenced(uuid,uuid) from public,anon,authenticated;

-- A changed/removed personal email invalidates the old identity binding immediately.
create or replace function app.detach_identity_on_email_change() returns trigger
language plpgsql security definer set search_path=app,public as $$
declare v_account uuid;
begin
  if old.channel <> 'email' or old.guest_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='UPDATE' then
    if new.channel='email' and new.guest_id=old.guest_id
       and lower(trim(new.value))=lower(trim(old.value)) then return new; end if;
  end if;
  select self_account_id into v_account from app.guest
   where wedding_id=old.wedding_id and id=old.guest_id for update;
  update app.guest set self_account_id=null
   where wedding_id=old.wedding_id and id=old.guest_id;
  perform app.revoke_membership_if_unreferenced(old.wedding_id,v_account);
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create trigger household_contact_identity_update_guard
before update of channel,value,guest_id on app.household_contact
for each row execute function app.detach_identity_on_email_change();
create trigger household_contact_identity_delete_guard
before delete on app.household_contact
for each row execute function app.detach_identity_on_email_change();
revoke execute on function app.detach_identity_on_email_change() from public,anon,authenticated;

create or replace function app.manage_guest_identity(
  p_wedding uuid,p_guest uuid,p_household uuid,p_name text,p_email text,p_directory boolean
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_email text;
begin
  if not (app.is_wedding_owner(p_wedding) or app.can_admin_guest(p_wedding,p_guest)) then
    raise exception 'not authorized to manage this guest';
  end if;
  if not exists(select 1 from app.guest where wedding_id=p_wedding and id=p_guest and household_id=p_household for update) then
    raise exception 'guest not found in household';
  end if;
  update app.guest set full_name=coalesce(nullif(trim(p_name),''),full_name),
         show_in_directory=coalesce(p_directory,false)
   where wedding_id=p_wedding and id=p_guest;

  v_email:=nullif(lower(trim(coalesce(p_email,''))), '');
  delete from app.household_contact
   where wedding_id=p_wedding and guest_id=p_guest and channel='email'
     and (v_email is null or lower(trim(value))<>v_email);
  if v_email is not null and not exists(
    select 1 from app.household_contact where wedding_id=p_wedding and guest_id=p_guest
      and channel='email' and lower(trim(value))=v_email
  ) then
    insert into app.household_contact(wedding_id,household_id,guest_id,channel,value,is_shared)
    values(p_wedding,p_household,p_guest,'email',v_email,false);
  end if;

  insert into app.directory_consent(wedding_id,guest_id,field,visible)
  values(p_wedding,p_guest,'name',coalesce(p_directory,false))
  on conflict(wedding_id,guest_id,field) do update set visible=excluded.visible;
end $$;

revoke execute on function app.manage_guest_identity(uuid,uuid,uuid,text,text,boolean) from public,anon;
grant execute on function app.manage_guest_identity(uuid,uuid,uuid,text,text,boolean) to authenticated;

-- Any guest deletion also retires a membership that has no remaining authority basis.
create or replace function app.revoke_deleted_guest_membership() returns trigger
language plpgsql security definer set search_path=app,public as $$
begin
  perform app.revoke_membership_if_unreferenced(old.wedding_id,old.self_account_id);
  return old;
end $$;
create trigger guest_membership_cleanup after delete on app.guest
for each row execute function app.revoke_deleted_guest_membership();
revoke execute on function app.revoke_deleted_guest_membership() from public,anon,authenticated;
