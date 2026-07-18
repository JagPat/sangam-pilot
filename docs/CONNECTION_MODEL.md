# Connection model (why RLS is real defense)

The security boundary is the **connection model**, not RLS alone. RLS is defense-in-depth *under*
application authorization.

## Identity mapping
- `account` is Sangam's person-who-can-log-in. It is **wedding-agnostic** (no `wedding_id`).
- `account.auth_user_id` references `auth.users(id)` (Supabase Auth), `UNIQUE`.
- `app.current_account_id()` resolves `auth.uid()` → `account.id`. All user-context RLS policies build
  on this plus `wedding_membership`.

## Magic links
- Sangam issues its own `guest_access_link` (opaque token, `issued_at/used_at/expires_at`, bound to a
  guest/invitation). Opening it is exchanged **server-side** for a Supabase Auth session.
- We do **not** persist Supabase auth secrets; `guest_access_link` stores only Sangam's own token
  state and lifecycle.

## Two execution paths
1. **User context (default).** Ordinary guest/host requests run with the end user's Supabase session;
   RLS applies. The browser only ever holds the **anon** key + the user's session — never the
   service-role key.
2. **Named service commands (narrow).** Imports, webhook processing, and scheduled jobs run with the
   **service-role** key on the server only. Each is a single named function that:
   - takes an explicit `wedding_id` context,
   - asserts a system purpose,
   - and has **its own isolation test** (see `supabase/tests/`).
   Service-role must not become a general "bypass RLS" client for request handling.

## RLS posture
- RLS is **enabled on every table** at creation → deny-by-default (no policy = no access).
- Slice-1 tables ship with representative **user-context policies** (see `0001` helpers +
  policy blocks in each migration). Remaining tables follow the same pattern as their module lands.
- `SECURITY DEFINER` functions (e.g. `propose_rsvp_change`, `confirm_rsvp_change`) run with a fixed
  `search_path` and re-check authorization internally; they are the *only* sanctioned way to mutate
  RSVP state, so web and bot share one authorized path.

## Exposing the `app` schema to the client
The RSVP path is exposed via **public** RPC wrappers (`public.propose_rsvp_change` /
`public.confirm_rsvp_change`), so no schema config is needed for writes. For direct **reads** the app
uses `supabase.schema('app')...`, which requires `app` to be in PostgREST's exposed schemas — add it in
`supabase/config.toml`:

```toml
[api]
schemas = ["public", "app"]
```

Prefer exposing read access through `public` views or RPCs over time if you'd rather keep `app`
un-exposed; either way, RLS remains the row filter.

## Helper functions (in 0001)
- `app.current_account_id() → uuid`
- `app.is_member(p_wedding uuid) → bool`
- `app.is_wedding_owner(p_wedding uuid) → bool`
- `app.is_group_admin(p_wedding uuid, p_group uuid) → bool`
- `app.can_act_for_guest(p_guest uuid) → bool`  (self, or an active, unexpired delegation)
