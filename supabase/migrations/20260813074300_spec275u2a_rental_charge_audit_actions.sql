-- Spec 275 U2a — audit-action enum values for the rental-charge RPCs.
--
-- A new enum value cannot be USED in the same transaction that adds it, so these
-- land in their OWN migration, BEFORE the RPC migration whose bodies write the
-- literals ('rental_charge_add' / 'rental_charge_void'). Mirrors spec 260 U1a.
alter type public.audit_action add value if not exists 'rental_charge_add';
alter type public.audit_action add value if not exists 'rental_charge_void';
