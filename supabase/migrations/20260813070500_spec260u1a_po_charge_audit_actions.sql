-- Spec 260 U1a — 'po_charge_add' / 'po_charge_void' join audit_action (own
-- migration on purpose: a new enum value is unusable inside the transaction
-- that adds it, same reason as 20260813069000 registered
-- 'purchase_order_void' before spec 259's RPC could reference it, and
-- 20260813067000 for the subcontract actions). Must land BEFORE the charge
-- RPC migration (20260813070700) writes either literal — CREATE FUNCTION does
-- not validate an enum literal in its body, only execution does, so the split
-- is what keeps the RPC callable in its own first transaction.
alter type public.audit_action add value if not exists 'po_charge_add';
alter type public.audit_action add value if not exists 'po_charge_void';
