-- Account holders may edit only a harmless display preference. Identity, status, and platform capabilities
-- are server-managed and must never be writable through the broad account_self_update RLS policy.

revoke insert,update,delete on app.account from authenticated;
grant update(preferred_language) on app.account to authenticated;

comment on policy account_self_update on app.account is
  'Row scope for the column-limited preferred_language update grant; protected identity/capability columns have no client privilege.';
