-- Spec 275 U3a — audit-action enum values for the rental-settlement RPCs.
--
-- A new enum value cannot be USED in the same transaction that adds it, so these
-- land in their OWN migration, BEFORE the RPC migration whose bodies write the
-- literals ('rental_settlement_record' / 'rental_settlement_supersede'). Mirrors
-- spec 275 U2a / spec 260 U1a. The WHT cert the settlement issues reuses the
-- pre-existing 'wht_certificate_record' value (no new value needed there).
alter type public.audit_action add value if not exists 'rental_settlement_record';
alter type public.audit_action add value if not exists 'rental_settlement_supersede';
