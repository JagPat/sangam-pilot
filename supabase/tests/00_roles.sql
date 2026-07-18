-- 00_roles.sql — for a LOCAL Postgres only. Supabase already provides these roles.
-- Run BEFORE the migrations locally so 0007_grants.sql can grant to them.
do $$ begin
  if not exists (select from pg_roles where rolname='anon')          then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  -- service_role bypasses RLS in Supabase; mirror that so service tests are realistic
  if not exists (select from pg_roles where rolname='service_role')  then create role service_role nologin bypassrls; end if;
end $$;
