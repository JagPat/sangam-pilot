-- Commit additive enum values in their own migration. PostgreSQL forbids using a new enum
-- value until the transaction that added it has committed.
alter type app.operator_role_kind add value if not exists 'event_manager';
alter type app.operator_role_kind add value if not exists 'finance_admin';
