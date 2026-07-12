-- Spec 310: audit actions for office-expense events. Separate migration so the
-- new enum values are committed before the RPC migration (075761) uses them
-- (Postgres forbids using a new enum value in the same transaction it is added).
alter type public.audit_action add value if not exists 'office_expense_record';
alter type public.audit_action add value if not exists 'office_expense_reimburse';
