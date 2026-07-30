-- Authoritative read model for the organizer room plan. All views invoke underlying RLS.

create view app.room_plan with (security_invoker=true) as
select a.wedding_id,a.id as allocation_id,a.room_id,a.primary_household_id,
       h.id as hotel_id,h.name as property_name,h.property_kind,h.property_status,
       r.provisional_code,r.physical_room_number,r.capacity,r.inventory_status,
       a.occupancy_plan,a.single_occupancy_exception_reason,a.status,a.check_in,a.check_out,
       a.sharing_confirmed_at,a.sharing_confirmed_by,a.sharing_confirmed_revision,a.sync_revision,
       coalesce(occ.occupant_count,0)::int as occupant_count,
       coalesce(occ.guest_ids,'{}'::uuid[]) as guest_ids,
       coalesce(occ.guest_names,'{}'::text[]) as guest_names,
       coalesce(occ.household_count,0)>1 as cross_household
from app.room_allocation a
join app.room r on r.wedding_id=a.wedding_id and r.id=a.room_id
join app.hotel h on h.wedding_id=r.wedding_id and h.id=r.hotel_id
left join lateral (
  select count(*) as occupant_count,
         array_agg(o.guest_id order by g.full_name,o.guest_id) as guest_ids,
         array_agg(coalesce(g.full_name,'') order by g.full_name,o.guest_id) as guest_names,
         count(distinct g.household_id) as household_count
  from app.room_occupant o
  join app.guest g on g.wedding_id=o.wedding_id and g.id=o.guest_id
  where o.wedding_id=a.wedding_id and o.allocation_id=a.id
) occ on true
where a.status<>'cancelled';

create view app.room_plan_summary with (security_invoker=true) as
select wedding_id,hotel_id,property_name,occupancy_plan,
       count(*) filter(where status in ('confirmed','checked_in'))::int as confirmed_rooms,
       count(*) filter(where status='held')::int as draft_rooms,
       count(*) filter(where status in ('held','confirmed','checked_in') and physical_room_number is null)::int as missing_physical_numbers,
       count(*) filter(where status in ('held','confirmed','checked_in') and sharing_confirmed_at is null)::int as unconfirmed_rooms
from app.room_plan
group by wedding_id,hotel_id,property_name,occupancy_plan;

create view app.unallocated_stay_guest with (security_invoker=true) as
select srg.wedding_id,srg.stay_request_id,srg.guest_id,g.household_id,g.full_name
from app.stay_request_guest srg
join app.guest g on g.wedding_id=srg.wedding_id and g.id=srg.guest_id
where not exists(
  select 1 from app.room_occupant o
  join app.room_allocation a on a.wedding_id=o.wedding_id and a.id=o.allocation_id
  where o.wedding_id=srg.wedding_id and o.guest_id=srg.guest_id
    and a.status in ('confirmed','checked_in')
);

create view app.room_plan_exception with (security_invoker=true) as
select wedding_id,allocation_id,room_id,'single_reason_missing'::text as exception_code,
       'Single occupancy requires an approved reason'::text as detail
from app.room_plan
where status in ('held','confirmed','checked_in') and occupancy_plan='single'
  and nullif(trim(single_occupancy_exception_reason),'') is null
union all
select wedding_id,allocation_id,room_id,'sharing_unconfirmed',
       'The current sharing group has not been confirmed'
from app.room_plan
where status in ('held','confirmed','checked_in') and sharing_confirmed_at is null
union all
select wedding_id,allocation_id,room_id,'occupancy_mismatch',
       'Confirmed occupant count does not match the occupancy plan'
from app.room_plan
where status in ('confirmed','checked_in') and occupant_count<>case occupancy_plan when 'single' then 1 when 'double' then 2 else 3 end
union all
select wedding_id,allocation_id,room_id,'physical_number_missing',
       'The property has not issued a physical room number'
from app.room_plan
where status in ('held','confirmed','checked_in') and physical_room_number is null
union all
select wedding_id,allocation_id,room_id,'property_tbd',
       'The outside property is still provisional'
from app.room_plan
where status in ('held','confirmed','checked_in') and property_status='provisional';

grant select on app.room_plan,app.room_plan_summary,app.unallocated_stay_guest,app.room_plan_exception to authenticated;

