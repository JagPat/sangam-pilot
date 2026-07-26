-- 0022_group_vendor_read.sql
-- Family-admin oversight of vendors + finance for their own side (last roadmap layer).
--
-- FINANCE needs no change: 0011's finance RLS is already side-aware — finance_can_read_expense /
-- finance_can_read_allocation let a host_group_admin read the expenses their family paid or is responsible
-- for, and finance_net_position is gated to any finance viewer (owner OR a host_group_admin). So a family
-- admin can already read their side's spend + the net-position split; this layer just adds the UI.
--
-- VENDORS were owner-only (0014). This adds a READ path for a family admin to the vendors THEIR side sources
-- (vendor.host_group_id) and those vendors' engagements — read-only; the owner still owns all vendor writes.
-- The engagement policy routes through a SECURITY DEFINER helper so it never inline-queries the vendor RLS
-- table as the invoker (no recursion).

create or replace function app.can_admin_vendor(p_wedding uuid, p_vendor uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.vendor v
    where v.wedding_id = p_wedding and v.id = p_vendor
      and v.host_group_id is not null and app.is_group_admin(p_wedding, v.host_group_id)
  );
$$;

create policy vendor_group_admin_read on app.vendor for select
  using (host_group_id is not null and app.is_group_admin(wedding_id, host_group_id));

create policy engagement_group_admin_read on app.engagement for select
  using (app.can_admin_vendor(wedding_id, vendor_id));

revoke all on function app.can_admin_vendor(uuid, uuid) from public;
grant execute on function app.can_admin_vendor(uuid, uuid) to authenticated;
