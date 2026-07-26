alter table app.account add column can_create_wedding boolean not null default false;
update app.account a set can_create_wedding=true
 where exists(select 1 from app.operator_role r where r.account_id=a.id and r.role='wedding_owner');

create or replace function app.create_wedding(p_title text,p_couple text,p_tz text,p_start date,p_end date)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_acc uuid; v_wed uuid;
begin
  v_acc:=app.current_account_id();
  if v_acc is null then raise exception 'must be signed in to create a wedding'; end if;
  if not exists(select 1 from app.account where id=v_acc and can_create_wedding) then
    raise exception 'account is not provisioned to create weddings' using errcode='42501';
  end if;
  if p_title is null or length(trim(p_title))=0 then raise exception 'a wedding title is required'; end if;
  if p_tz is not null and not exists(select 1 from pg_timezone_names where name=p_tz) then raise exception 'unknown IANA timezone'; end if;
  insert into app.wedding(title,couple_names,default_timezone,start_date,end_date)
  values(trim(p_title),nullif(trim(coalesce(p_couple,'')),''),coalesce(nullif(trim(coalesce(p_tz,'')),''),'Asia/Kolkata'),p_start,p_end)
  returning id into v_wed;
  insert into app.wedding_membership(wedding_id,account_id,status) values(v_wed,v_acc,'active');
  insert into app.operator_role(wedding_id,account_id,role) values(v_wed,v_acc,'wedding_owner');
  return v_wed;
end $$;
revoke execute on function app.create_wedding(text,text,text,date,date) from public,anon;
grant execute on function app.create_wedding(text,text,text,date,date) to authenticated;
