-- Spec 251 U1a — audit_action enum additions for subcontracts. Own migration:
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as its
-- subsequent use (house lesson, matches every other audit-action-add migration
-- in this build, e.g. 20260813063000/062500).

alter type public.audit_action add value if not exists 'subcontract_create';
alter type public.audit_action add value if not exists 'subcontract_update';
alter type public.audit_action add value if not exists 'subcontract_wps_set';
alter type public.audit_action add value if not exists 'subcontract_payment_record';
alter type public.audit_action add value if not exists 'subcontract_payment_supersede';
