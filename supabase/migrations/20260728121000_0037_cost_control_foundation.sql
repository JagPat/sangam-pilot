-- Official wedding Cost Control foundation. Costs belong to the wedding client, never to a family side.

alter type app.operator_role_kind add value if not exists 'cost_approver';

alter table app.operator_role drop constraint operator_role_group_shape;
alter table app.operator_role add constraint operator_role_group_shape check (
  (role::text in ('wedding_owner','event_manager','finance_admin','cost_approver') and host_group_id is null)
  or (role::text in ('host_group_admin','co_host') and host_group_id is not null)
);

create or replace function app.is_cost_approver(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_member(p_wedding) and exists (
    select 1 from app.operator_role r
     where r.wedding_id=p_wedding and r.account_id=app.current_account_id()
       and r.role::text='cost_approver'
  );
$$;

create or replace function app.can_access_cost_control(p_wedding uuid) returns boolean
language sql stable security definer set search_path=app,public as $$
  select app.is_event_manager(p_wedding) or app.is_cost_approver(p_wedding);
$$;

create table app.cost_centre(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  parent_id uuid,
  template_key text,
  name text not null check(length(trim(name))>0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(wedding_id,id),
  unique(wedding_id,template_key),
  foreign key(wedding_id,parent_id) references app.cost_centre(wedding_id,id)
);
create unique index cost_centre_active_name_unique
  on app.cost_centre(wedding_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name))
  where active;

create table app.cost_item(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  cost_centre_id uuid not null,
  event_instance_id uuid,
  engagement_id uuid,
  title text not null check(length(trim(title))>0),
  description text,
  lifecycle_state text not null default 'planning'
    check(lifecycle_state in ('planning','approved','committed','invoiced','closed','cancelled')),
  decision_owner_account_id uuid references app.account(id),
  decision_due_at timestamptz,
  created_by_account_id uuid not null references app.account(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(wedding_id,id),
  foreign key(wedding_id,cost_centre_id) references app.cost_centre(wedding_id,id),
  foreign key(wedding_id,event_instance_id) references app.event_instance(wedding_id,id),
  foreign key(wedding_id,engagement_id) references app.engagement(wedding_id,id)
);

alter table app.cost_centre enable row level security;
alter table app.cost_item enable row level security;
create policy cost_centre_authorized_read on app.cost_centre for select
  using(app.can_access_cost_control(wedding_id));
create policy cost_item_authorized_read on app.cost_item for select
  using(app.can_access_cost_control(wedding_id));

create or replace function app.initialize_cost_control(p_wedding uuid) returns integer
language plpgsql security definer set search_path=app,public as $$
declare v_created integer;
begin
  if not app.can_access_cost_control(p_wedding) then
    raise exception 'not authorized for Cost Control' using errcode='42501';
  end if;

  insert into app.cost_centre(wedding_id,template_key,name,sort_order)
  values
    (p_wedding,'venue_rooms','Venue and room inventory',10),
    (p_wedding,'food_beverage','Food and beverages',20),
    (p_wedding,'alcohol','Alcohol',30),
    (p_wedding,'decor_flowers','Decor and flowers',40),
    (p_wedding,'production','Sound, lighting, AV and production',50),
    (p_wedding,'entertainment','Artists and entertainment',60),
    (p_wedding,'photo_film','Photography and films',70),
    (p_wedding,'styling','Makeup and styling',80),
    (p_wedding,'stationery','Invitations and stationery',90),
    (p_wedding,'gifts','Hampers and gifts',100),
    (p_wedding,'hospitality','Guest hospitality',110),
    (p_wedding,'transport','Airport and local transport',120),
    (p_wedding,'vendor_logistics','Vendor travel, rooms and meals',130),
    (p_wedding,'permissions','Permissions and licences',140),
    (p_wedding,'ceremonial','Rituals and ceremonial requirements',150),
    (p_wedding,'management_fee','Event-management fee',160),
    (p_wedding,'taxes','Taxes',170),
    (p_wedding,'contingency','Contingency',180),
    (p_wedding,'miscellaneous','Miscellaneous',190)
  on conflict(wedding_id,template_key) do nothing;
  get diagnostics v_created=row_count;
  return v_created;
end $$;

create or replace function app.owner_assign_wedding_role(p_wedding uuid,p_email text,p_role text)
returns uuid language plpgsql security definer set search_path=app,public as $$
declare v_acc uuid; v_email text:=lower(trim(coalesce(p_email,'')));
begin
  if not app.is_wedding_owner(p_wedding) then
    raise exception 'not authorized to manage this wedding' using errcode='42501';
  end if;
  if v_email='' or position('@' in v_email)=0 then raise exception 'a valid email is required'; end if;
  if p_role not in ('event_manager','cost_approver') then
    raise exception 'role must be event_manager or cost_approver';
  end if;
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

grant select on app.cost_centre,app.cost_item to authenticated,service_role;
revoke insert,update,delete on app.cost_centre,app.cost_item from public,anon,authenticated;
grant insert,update,delete on app.cost_centre,app.cost_item to service_role;

revoke execute on function app.is_cost_approver(uuid) from public,anon;
revoke execute on function app.can_access_cost_control(uuid) from public,anon;
revoke execute on function app.initialize_cost_control(uuid) from public,anon;
revoke execute on function app.owner_assign_wedding_role(uuid,text,text) from public,anon;
grant execute on function app.is_cost_approver(uuid),app.can_access_cost_control(uuid),app.initialize_cost_control(uuid),app.owner_assign_wedding_role(uuid,text,text) to authenticated,service_role;
