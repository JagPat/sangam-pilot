-- Serialize commitment approval per cost item and enforce one current approved commitment in the database.

create unique index cost_commitment_one_approved
  on app.cost_commitment(wedding_id,cost_item_id) where state='approved';

create or replace function app.decide_cost_commitment(
  p_wedding uuid,p_commitment uuid,p_decision text,p_reason text
) returns void language plpgsql security definer set search_path=app,public as $$
declare v_actor uuid:=app.current_account_id(); v_item uuid; v_proposer uuid;
begin
  if not app.is_cost_approver(p_wedding) then raise exception 'cost approver required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'decision reason is required'; end if;
  select cost_item_id,proposed_by_account_id into v_item,v_proposer from app.cost_commitment
    where wedding_id=p_wedding and id=p_commitment and state='proposed' for update;
  if not found then raise exception 'commitment is not pending' using errcode='SA031'; end if;
  perform 1 from app.cost_item where wedding_id=p_wedding and id=v_item for update;
  if v_proposer=v_actor then raise exception 'proposer cannot approve their own commitment' using errcode='42501'; end if;
  if p_decision='approved' then
    update app.cost_commitment set state='superseded' where wedding_id=p_wedding and cost_item_id=v_item
      and state='approved' and id<>p_commitment;
  end if;
  update app.cost_commitment set state=p_decision::app.cost_commitment_state,approved_by_account_id=v_actor,
    decision_reason=trim(p_reason),decided_at=now() where wedding_id=p_wedding and id=p_commitment;
  if p_decision='approved' then
    update app.cost_item set lifecycle_state='committed',updated_at=now() where wedding_id=p_wedding and id=v_item;
  end if;
end $$;

revoke execute on function app.decide_cost_commitment(uuid,uuid,text,text) from public,anon;
grant execute on function app.decide_cost_commitment(uuid,uuid,text,text) to authenticated,service_role;
