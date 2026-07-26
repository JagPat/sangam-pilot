-- Wedding administrators may appoint operational and finance administrators without gaining either capability.
create or replace function app.owner_assign_wedding_role(p_wedding uuid,p_email text,p_role text)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_acc uuid; v_email text:=lower(trim(coalesce(p_email,'')));
begin
  if not app.is_wedding_owner(p_wedding) then raise exception 'not authorized to manage this wedding' using errcode='42501'; end if;
  if v_email='' or position('@' in v_email)=0 then raise exception 'a valid email is required'; end if;
  if p_role not in ('event_manager','finance_admin') then raise exception 'role must be event_manager or finance_admin'; end if;
  select id into v_acc from app.account where lower(email)=v_email
   order by (auth_user_id is not null) desc,created_at asc limit 1;
  if v_acc is null then insert into app.account(email) values(v_email) returning id into v_acc; end if;
  insert into app.wedding_membership(wedding_id,account_id,status) values(p_wedding,v_acc,'active')
  on conflict(wedding_id,account_id) do update set status='active';
  if not exists(select 1 from app.operator_role where wedding_id=p_wedding and account_id=v_acc and role::text=p_role and host_group_id is null) then
    insert into app.operator_role(wedding_id,account_id,role,host_group_id)
    values(p_wedding,v_acc,p_role::app.operator_role_kind,null);
  end if;
  return v_acc;
end $$;

revoke execute on function app.owner_assign_wedding_role(uuid,text,text) from public,anon;
grant execute on function app.owner_assign_wedding_role(uuid,text,text) to authenticated;
