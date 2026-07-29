-- Platform-controlled planner onboarding. Creator entitlement is account-level; event_manager remains
-- wedding-scoped. An approved planner who creates a client wedding receives both roles atomically.

create or replace function app.current_account_can_create_wedding()
returns boolean
language sql stable security definer set search_path=app,public as $$
  select exists (
    select 1 from app.account a
     where a.id=app.current_account_id() and a.can_create_wedding
  );
$$;

create or replace function app.super_admin_set_wedding_creator(p_email text,p_enabled boolean)
returns uuid
language plpgsql security definer set search_path=app,public as $$
declare
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_account uuid;
begin
  if not app.is_platform_super_admin() then
    raise exception 'platform administrator required' using errcode='42501';
  end if;
  if v_email='' or position('@' in v_email)=0 then
    raise exception 'valid email required' using errcode='22023';
  end if;

  select id into v_account
    from app.account
   where lower(trim(email))=v_email
   order by (auth_user_id is not null) desc,created_at asc
   limit 1
   for update;

  if v_account is null then
    insert into app.account(email,can_create_wedding)
    values(v_email,coalesce(p_enabled,false))
    returning id into v_account;
  else
    update app.account
       set can_create_wedding=coalesce(p_enabled,false),updated_at=now()
     where id=v_account;
  end if;

  return v_account;
end $$;

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

revoke execute on function app.current_account_can_create_wedding() from public,anon;
revoke execute on function app.super_admin_set_wedding_creator(text,boolean) from public,anon;
revoke execute on function app.create_wedding(text,text,text,date,date) from public,anon;

grant execute on function app.current_account_can_create_wedding() to authenticated,service_role;
grant execute on function app.super_admin_set_wedding_creator(text,boolean) to authenticated;
grant execute on function app.create_wedding(text,text,text,date,date) to authenticated,service_role;
