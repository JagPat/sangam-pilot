-- Enforce a coherent wedding date range at the database boundary and in the creator RPC.
-- Existing reversed ranges cannot be repaired reliably, so preserve the start date and clear the unknown end date.

update app.wedding
   set end_date = null,
       updated_at = now()
 where start_date is not null
   and end_date is not null
   and end_date < start_date;

alter table app.wedding
  add constraint wedding_date_range
  check (start_date is null or end_date is null or end_date >= start_date);

create or replace function app.create_wedding(
  p_title text,p_couple text,p_tz text,p_start date,p_end date
) returns uuid
language plpgsql security definer set search_path=app,public as $$
declare v_acc uuid; v_wed uuid;
begin
  v_acc:=app.current_account_id();
  if v_acc is null then
    raise exception 'must be signed in to create a wedding' using errcode='42501';
  end if;
  if not exists(select 1 from app.account where id=v_acc and can_create_wedding) then
    raise exception 'account is not provisioned to create weddings' using errcode='42501';
  end if;
  if p_title is null or length(trim(p_title))=0 then
    raise exception 'a wedding title is required' using errcode='22023';
  end if;
  if p_tz is not null and not exists(select 1 from pg_timezone_names where name=p_tz) then
    raise exception 'unknown IANA timezone' using errcode='22023';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    raise exception 'end date cannot be before start date' using errcode='22023';
  end if;

  insert into app.wedding(title,couple_names,default_timezone,start_date,end_date)
  values(
    trim(p_title),
    nullif(trim(coalesce(p_couple,'')),''),
    coalesce(nullif(trim(coalesce(p_tz,'')),''),'Asia/Kolkata'),
    p_start,p_end
  ) returning id into v_wed;

  insert into app.wedding_membership(wedding_id,account_id,status)
  values(v_wed,v_acc,'active');

  insert into app.operator_role(wedding_id,account_id,role,host_group_id) values
    (v_wed,v_acc,'wedding_owner',null),
    (v_wed,v_acc,'event_manager',null);

  return v_wed;
end $$;

revoke execute on function app.create_wedding(text,text,text,date,date) from public,anon;
grant execute on function app.create_wedding(text,text,text,date,date) to authenticated,service_role;
