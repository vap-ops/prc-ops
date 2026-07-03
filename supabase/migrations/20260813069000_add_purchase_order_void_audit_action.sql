-- Spec 259 — 'purchase_order_void' joins audit_action (own migration on
-- purpose: a new enum value is unusable inside the transaction that adds it,
-- same reason as 20260614120000/add_cancelled_status.sql). Must land before
-- void_purchase_order (20260813068000) is ever CALLED — CREATE FUNCTION
-- itself doesn't validate the enum literal, only execution does.
alter type public.audit_action add value if not exists 'purchase_order_void';
