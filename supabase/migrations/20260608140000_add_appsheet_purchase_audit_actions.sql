-- Purchasing P2 — add 'purchase_request_purchase' and
-- 'purchase_request_delivery' to public.audit_action.
--
-- Why this migration is separate from the next one:
--   ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction
--   it lands in. The trigger function in migration …140200 INSERTs into
--   audit_log with these enum values; it must run in a later transaction.
--   Mirrors the 130000/130100 split used for P1b.
--
-- 'if not exists' guards idempotency in the event of a re-run after a
-- partial apply (same pattern as P1b's 130000 migration).

alter type public.audit_action add value if not exists 'purchase_request_purchase';
alter type public.audit_action add value if not exists 'purchase_request_delivery';
