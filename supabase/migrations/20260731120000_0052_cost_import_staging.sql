-- Staged official-line imports. The import boundary accepts no family target, opinion, funding or payer data.

create type app.cost_import_state as enum ('staged','committed');
create type app.cost_import_resolution as enum ('matched','create','unresolved');

alter table app.cost_estimate_version
  add constraint cost_estimate_wedding_item_id_unique unique(wedding_id,cost_item_id,id);

create table app.cost_import_batch(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references app.wedding(id) on delete cascade,
  import_key text not null check(length(trim(import_key)) between 1 and 128),
  source_name text not null check(length(trim(source_name)) between 1 and 200),
  payload_hash bytea not null,
  state app.cost_import_state not null default 'staged',
  created_by_account_id uuid not null references app.account(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique(wedding_id,id),
  unique(wedding_id,import_key),
  check((state='staged' and committed_at is null) or (state='committed' and committed_at is not null))
);

create table app.cost_import_line(
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null,
  batch_id uuid not null,
  source_line_id text not null check(length(trim(source_line_id)) between 1 and 200),
  source_order integer not null check(source_order>0),
  title text not null check(length(trim(title)) between 1 and 200),
  cost_centre_id uuid,
  matched_cost_item_id uuid,
  subtotal numeric(14,2) not null check(subtotal>=0),
  tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  currency_code char(3) not null check(currency_code in ('INR','USD')),
  scope_included text check(length(scope_included)<=2000),
  scope_excluded text check(length(scope_excluded)<=2000),
  resolution app.cost_import_resolution not null,
  match_confirmed boolean not null default false,
  committed_item_id uuid,
  committed_estimate_id uuid,
  created_at timestamptz not null default now(),
  unique(wedding_id,id),
  unique(wedding_id,batch_id,source_line_id),
  foreign key(wedding_id,batch_id) references app.cost_import_batch(wedding_id,id) on delete cascade,
  foreign key(wedding_id,cost_centre_id) references app.cost_centre(wedding_id,id),
  foreign key(wedding_id,matched_cost_item_id) references app.cost_item(wedding_id,id),
  foreign key(wedding_id,committed_item_id) references app.cost_item(wedding_id,id),
  foreign key(wedding_id,committed_item_id,committed_estimate_id)
    references app.cost_estimate_version(wedding_id,cost_item_id,id),
  check(
    (resolution='unresolved' and cost_centre_id is null and matched_cost_item_id is null and not match_confirmed)
    or (resolution='create' and cost_centre_id is not null and matched_cost_item_id is null and match_confirmed)
    or (resolution='matched' and cost_centre_id is not null and matched_cost_item_id is not null)
  ),
  check((committed_item_id is null)=(committed_estimate_id is null))
);
create index cost_import_line_batch_order on app.cost_import_line(wedding_id,batch_id,source_order);

alter table app.cost_import_batch enable row level security;
alter table app.cost_import_line enable row level security;
create policy cost_import_batch_authorized_read on app.cost_import_batch for select
  using(app.can_access_cost_control(wedding_id));
create policy cost_import_line_authorized_read on app.cost_import_line for select
  using(app.can_access_cost_control(wedding_id));

create or replace function app.stage_cost_import(
  p_wedding uuid,p_import_key text,p_source_name text,p_lines jsonb
) returns uuid language plpgsql security definer set search_path=app,public as $$
declare
  v_actor uuid:=app.current_account_id();
  v_batch uuid;
  v_existing_state app.cost_import_state;
  v_existing_hash bytea;
  v_hash bytea;
  v_line jsonb;
  v_source text;
  v_title text;
  v_currency text;
  v_resolution text;
  v_centre uuid;
  v_supplied_centre uuid;
  v_item uuid;
  v_subtotal numeric;
  v_tax numeric;
  v_order integer:=0;
begin
  if not app.is_event_manager(p_wedding) then
    raise exception 'event manager required for cost import' using errcode='42501';
  end if;
  if nullif(trim(coalesce(p_import_key,'')),'') is null or length(trim(p_import_key))>128
    or nullif(trim(coalesce(p_source_name,'')),'') is null or length(trim(p_source_name))>200 then
    raise exception 'import key and source name are required' using errcode='22023';
  end if;
  perform app.assert_official_cost_text(p_source_name);
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>500 then
    raise exception 'import must contain between 1 and 500 lines' using errcode='22023';
  end if;
  v_hash:=digest(p_lines::text,'sha256');
  select id,state,payload_hash into v_batch,v_existing_state,v_existing_hash
    from app.cost_import_batch where wedding_id=p_wedding and import_key=trim(p_import_key) for update;
  if found then
    if v_existing_hash<>v_hash then
      raise exception 'import key is already bound to different content' using errcode='23505';
    end if;
    return v_batch;
  end if;

  insert into app.cost_import_batch(wedding_id,import_key,source_name,payload_hash,created_by_account_id)
  values(p_wedding,trim(p_import_key),trim(p_source_name),v_hash,v_actor) returning id into v_batch;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_order:=v_order+1;
    v_source:=trim(coalesce(v_line->>'source_line_id',''));
    v_title:=trim(coalesce(v_line->>'title',''));
    v_currency:=upper(trim(coalesce(v_line->>'currency_code','')));
    v_resolution:=lower(trim(coalesce(v_line->>'resolution','unresolved')));
    v_subtotal:=nullif(v_line->>'subtotal','')::numeric;
    v_tax:=coalesce(nullif(v_line->>'tax_rate','')::numeric,0);
    v_supplied_centre:=nullif(v_line->>'cost_centre_id','')::uuid;
    v_item:=nullif(v_line->>'matched_cost_item_id','')::uuid;
    v_centre:=v_supplied_centre;

    perform app.assert_official_cost_text(v_title);
    perform app.assert_official_cost_text(v_line->>'scope_included');
    perform app.assert_official_cost_text(v_line->>'scope_excluded');
    if v_source='' or length(v_source)>200 or v_title='' or length(v_title)>200
      or v_subtotal is null or v_subtotal<0 or v_tax not between 0 and 100
      or v_currency not in('INR','USD') or v_resolution not in('matched','create','unresolved') then
      raise exception 'invalid official import line %',v_order using errcode='22023';
    end if;

    if v_resolution='matched' then
      if v_item is null then raise exception 'matched line requires an existing item' using errcode='22023'; end if;
      select cost_centre_id into v_centre from app.cost_item where wedding_id=p_wedding and id=v_item;
      if not found or (v_supplied_centre is not null and v_supplied_centre<>v_centre) then
        raise exception 'matched item is not in this wedding and centre' using errcode='23503';
      end if;
    elsif v_resolution='create' then
      if v_item is not null or v_centre is null
        or not exists(select 1 from app.cost_centre where wedding_id=p_wedding and id=v_centre) then
        raise exception 'create line requires a centre in this wedding' using errcode='23503';
      end if;
    else
      if v_item is not null or v_centre is not null then
        raise exception 'unresolved line cannot carry a target' using errcode='22023';
      end if;
    end if;

    insert into app.cost_import_line(
      wedding_id,batch_id,source_line_id,source_order,title,cost_centre_id,matched_cost_item_id,
      subtotal,tax_rate,currency_code,scope_included,scope_excluded,resolution,match_confirmed
    ) values(
      p_wedding,v_batch,v_source,v_order,v_title,v_centre,v_item,round(v_subtotal,2),v_tax,v_currency,
      nullif(trim(coalesce(v_line->>'scope_included','')),''),nullif(trim(coalesce(v_line->>'scope_excluded','')),''),
      v_resolution::app.cost_import_resolution,v_resolution='create'
    );
  end loop;
  return v_batch;
end $$;

create or replace function app.confirm_cost_import_matches(
  p_wedding uuid,p_batch uuid,p_line_ids uuid[]
) returns integer language plpgsql security definer set search_path=app,public as $$
declare v_updated integer;
begin
  if not app.is_event_manager(p_wedding) then
    raise exception 'event manager required for cost import' using errcode='42501';
  end if;
  perform 1 from app.cost_import_batch where wedding_id=p_wedding and id=p_batch and state='staged' for update;
  if not found then raise exception 'import batch is not staged' using errcode='23514'; end if;
  if cardinality(coalesce(p_line_ids,array[]::uuid[]))=0 then return 0; end if;
  update app.cost_import_line set match_confirmed=true
    where wedding_id=p_wedding and batch_id=p_batch and resolution='matched' and id=any(p_line_ids);
  get diagnostics v_updated=row_count;
  if v_updated<>cardinality(p_line_ids) then
    raise exception 'one or more match lines are invalid' using errcode='23514';
  end if;
  return v_updated;
end $$;

create or replace function app.resolve_cost_import_line(
  p_wedding uuid,p_line uuid,p_centre uuid,p_matched_item uuid
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_batch uuid; v_actual_centre uuid;
begin
  if not app.is_event_manager(p_wedding) then
    raise exception 'event manager required for cost import' using errcode='42501';
  end if;
  select batch_id into v_batch from app.cost_import_line where wedding_id=p_wedding and id=p_line for update;
  if not found or not exists(select 1 from app.cost_import_batch where wedding_id=p_wedding and id=v_batch and state='staged') then
    raise exception 'import line is not staged' using errcode='23514';
  end if;
  if p_matched_item is not null then
    select cost_centre_id into v_actual_centre from app.cost_item where wedding_id=p_wedding and id=p_matched_item;
    if not found or p_centre is distinct from v_actual_centre then
      raise exception 'matched item is not in this wedding and centre' using errcode='23503';
    end if;
    update app.cost_import_line set cost_centre_id=p_centre,matched_cost_item_id=p_matched_item,
      resolution='matched',match_confirmed=false where wedding_id=p_wedding and id=p_line;
  else
    if p_centre is null or not exists(select 1 from app.cost_centre where wedding_id=p_wedding and id=p_centre) then
      raise exception 'create line requires a centre in this wedding' using errcode='23503';
    end if;
    update app.cost_import_line set cost_centre_id=p_centre,matched_cost_item_id=null,
      resolution='create',match_confirmed=true where wedding_id=p_wedding and id=p_line;
  end if;
end $$;

create or replace function app.commit_cost_import(
  p_wedding uuid,p_batch uuid
) returns jsonb language plpgsql security definer set search_path=app,public as $$
declare
  v_actor uuid:=app.current_account_id();
  v_state app.cost_import_state;
  v_line app.cost_import_line%rowtype;
  v_item uuid;
  v_estimate uuid;
  v_version integer;
  v_written integer:=0;
begin
  if not app.is_event_manager(p_wedding) then
    raise exception 'event manager required for cost import' using errcode='42501';
  end if;
  select state into v_state from app.cost_import_batch
    where wedding_id=p_wedding and id=p_batch for update;
  if not found then raise exception 'unknown cost import batch' using errcode='42501'; end if;
  if v_state='committed' then return jsonb_build_object('written_lines',0,'idempotent',true); end if;
  if not exists(select 1 from app.cost_import_line where wedding_id=p_wedding and batch_id=p_batch) then
    raise exception 'cost import batch has no lines' using errcode='23514';
  end if;
  if exists(select 1 from app.cost_import_line where wedding_id=p_wedding and batch_id=p_batch
    and (resolution='unresolved' or (resolution='matched' and not match_confirmed))) then
    raise exception 'every import line must be resolved and every match confirmed' using errcode='23514';
  end if;
  if exists(
    select 1 from app.cost_import_line
    where wedding_id=p_wedding and batch_id=p_batch and resolution='matched'
    group by matched_cost_item_id having count(*)>1
  ) then
    raise exception 'an existing item can be matched only once per import batch' using errcode='23514';
  end if;
  if exists(
    select 1 from app.cost_import_line l
    join app.cost_estimate_version e on e.wedding_id=l.wedding_id and e.cost_item_id=l.matched_cost_item_id and e.state='draft'
    where l.wedding_id=p_wedding and l.batch_id=p_batch and l.resolution='matched'
  ) then
    raise exception 'a matched item already has an active draft' using errcode='23514';
  end if;

  perform 1 from app.cost_item i where i.wedding_id=p_wedding and i.id in(
    select matched_cost_item_id from app.cost_import_line where wedding_id=p_wedding and batch_id=p_batch
  ) order by i.id for update;

  -- Recheck after acquiring every target-item lock. A concurrent draft save or another import may have
  -- committed while this transaction was waiting; the later transaction must fail instead of creating
  -- a second editable draft or racing the version number.
  if exists(
    select 1 from app.cost_import_line l
    join app.cost_estimate_version e on e.wedding_id=l.wedding_id and e.cost_item_id=l.matched_cost_item_id and e.state='draft'
    where l.wedding_id=p_wedding and l.batch_id=p_batch and l.resolution='matched'
  ) then
    raise exception 'a matched item already has an active draft' using errcode='23514';
  end if;

  for v_line in select * from app.cost_import_line
    where wedding_id=p_wedding and batch_id=p_batch order by source_order for update
  loop
    if v_line.resolution='matched' then
      v_item:=v_line.matched_cost_item_id;
    else
      insert into app.cost_item(wedding_id,cost_centre_id,title,created_by_account_id)
      values(p_wedding,v_line.cost_centre_id,v_line.title,v_actor) returning id into v_item;
    end if;
    select coalesce(max(version_number),0)+1 into v_version
      from app.cost_estimate_version where wedding_id=p_wedding and cost_item_id=v_item;
    insert into app.cost_estimate_version(
      wedding_id,cost_item_id,version_number,origin,scope_included,scope_excluded,subtotal,tax_rate,
      currency_code,state,created_by_account_id
    ) values(
      p_wedding,v_item,v_version,'import',v_line.scope_included,v_line.scope_excluded,v_line.subtotal,
      v_line.tax_rate,v_line.currency_code,'draft',v_actor
    ) returning id into v_estimate;
    update app.cost_import_line set committed_item_id=v_item,committed_estimate_id=v_estimate
      where wedding_id=p_wedding and id=v_line.id;
    v_written:=v_written+1;
  end loop;
  update app.cost_import_batch set state='committed',committed_at=now()
    where wedding_id=p_wedding and id=p_batch;
  insert into app.audit_event(wedding_id,actor_account_id,action,target_ref,safe_summary)
  values(p_wedding,v_actor,'import',p_batch::text,'official cost import committed: '||v_written||' draft line(s)');
  return jsonb_build_object('written_lines',v_written,'idempotent',false);
end $$;

grant select on app.cost_import_batch,app.cost_import_line to authenticated,service_role;
revoke insert,update,delete on app.cost_import_batch,app.cost_import_line from public,anon,authenticated;
grant insert,update,delete on app.cost_import_batch,app.cost_import_line to service_role;

revoke execute on function app.stage_cost_import(uuid,text,text,jsonb),
  app.confirm_cost_import_matches(uuid,uuid,uuid[]),app.resolve_cost_import_line(uuid,uuid,uuid,uuid),
  app.commit_cost_import(uuid,uuid) from public,anon,authenticated;
grant execute on function app.stage_cost_import(uuid,text,text,jsonb),
  app.confirm_cost_import_matches(uuid,uuid,uuid[]),app.resolve_cost_import_line(uuid,uuid,uuid,uuid),
  app.commit_cost_import(uuid,uuid) to authenticated,service_role;
