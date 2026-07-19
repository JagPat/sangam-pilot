-- 0008_fix_pgcrypto_search_path.sql
-- On Supabase, the pgcrypto extension is installed in the `extensions` schema, not `public`. The
-- recipient-bound access-link functions call pgcrypto's gen_random_bytes()/digest() unqualified, so with
-- search_path = app, public they raise "function ... does not exist" at runtime. Add `extensions` to their
-- search_path. Portable: on a stock Postgres where pgcrypto lives in public, the extra entry is a no-op.
alter function app.issue_access_link(uuid, uuid, text, interval) set search_path = app, public, extensions;
alter function app.redeem_and_bind(text, uuid, text)             set search_path = app, public, extensions;
alter function app.peek_access_link(text)                        set search_path = app, public, extensions;
alter function app.peek_invite_details(text, text)               set search_path = app, public, extensions;
