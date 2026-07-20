-- 0009_account_self_link.sql
-- Self-service identity binding on sign-in. Until now a guest's login was linked to their guest record by
-- a MANUAL SQL step (§5 of the manual: set guest.self_account_id / account.auth_user_id by hand). This
-- function closes that loop so an organizer can add a guest with an email and the guest is bound
-- automatically the first time they sign in with that email — no per-guest SQL.
--
-- SERVICE-ONLY. Called from the trusted server path (lib/auth/link.ts via serviceCommand) right after a
-- verified sign-in, passing ONLY the validated auth user id. The email is re-derived here from auth.users,
-- so nothing the client controls decides which guest gets bound: the OTP-verified email is the sole key,
-- exactly the assurance the recipient-bound access-link flow relies on ("use the email your invite went
-- to — that is how we confirm it's you").
--
-- Idempotent and non-destructive: it only binds guests whose self_account_id IS NULL, so it can never
-- rebind (hijack) a guest already attached to someone, and re-running on every sign-in is a cheap no-op.

create or replace function app.link_signed_in_account(p_auth_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_email text;
  v_acc   uuid;
  g       record;
begin
  if p_auth_user_id is null then
    return null;
  end if;

  -- VERIFIED email straight from the auth record — never a client-supplied value.
  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_auth_user_id;

  -- 1) Resolve THIS auth user's app.account.
  select a.id into v_acc from app.account a where a.auth_user_id = p_auth_user_id;

  if v_acc is null then
    -- Adopt a pre-seeded account created with this email but never linked to an auth user (the §5 seed
    -- pattern: `insert into app.account (email) values (...)`). Only an UNLINKED row is adoptable, so we
    -- never steal an email that already belongs to a different auth user.
    if v_email is not null and length(v_email) > 0 then
      select a.id into v_acc
        from app.account a
        where a.auth_user_id is null and lower(trim(a.email)) = v_email
        order by a.created_at
        limit 1
        for update;
    end if;

    if v_acc is not null then
      update app.account
         set auth_user_id = p_auth_user_id,
             email        = coalesce(email, v_email),
             updated_at   = now()
       where id = v_acc;
    else
      insert into app.account (auth_user_id, email)
      values (p_auth_user_id, v_email)
      on conflict (auth_user_id) do update set email = coalesce(app.account.email, excluded.email)
      returning id into v_acc;
    end if;
  else
    -- keep the email fresh if the account was created without one
    update app.account
       set email = coalesce(email, v_email), updated_at = now()
     where id = v_acc and email is null and v_email is not null;
  end if;

  -- 2) Bind any UNBOUND guest whose PERSONAL email contact matches the verified email, and activate their
  -- membership so RLS (is_member / can_act_for_guest) recognizes them. Household-level SHARED contacts are
  -- deliberately excluded (guest_id must equal the guest) so one shared inbox can't bind a whole household
  -- to one account. Runs across every wedding — one email may be a guest in more than one.
  if v_email is not null and length(v_email) > 0 then
    for g in
      select distinct gg.id as guest_id, gg.wedding_id
        from app.guest gg
        join app.household_contact hc
          on hc.wedding_id = gg.wedding_id
         and hc.guest_id   = gg.id
         and hc.channel    = 'email'
         and lower(trim(hc.value)) = v_email
       where gg.self_account_id is null
    loop
      insert into app.wedding_membership (wedding_id, account_id, status)
      values (g.wedding_id, v_acc, 'active')
      on conflict (wedding_id, account_id) do update set status = 'active';

      update app.guest
         set self_account_id = v_acc
       where id = g.guest_id and wedding_id = g.wedding_id and self_account_id is null;
    end loop;
  end if;

  return v_acc;
end $$;

-- SERVICE-ONLY execute. Supabase's default privileges GRANT EXECUTE on new functions to public (and
-- directly to anon/authenticated), so strip all of them explicitly, then grant only service_role.
revoke execute on function app.link_signed_in_account(uuid) from public;
revoke execute on function app.link_signed_in_account(uuid) from anon;
revoke execute on function app.link_signed_in_account(uuid) from authenticated;
grant  execute on function app.link_signed_in_account(uuid) to service_role;
