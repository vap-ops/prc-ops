-- Spec 312: audit action for voiding an equipment-rental batch. Separate
-- migration so the new enum value is committed before the RPC migration (075781)
-- defines a function that stamps it (Postgres forbids using a new enum value in
-- the same transaction it is added).
alter type public.audit_action add value if not exists 'equipment_batch_void';
