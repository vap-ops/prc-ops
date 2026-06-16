-- Spec 127 U1 — audit action for record_dc_payment.
--
-- ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction that
-- adds it, so the value lands here (own migration) and the RPC that writes it
-- lives in the next migration (20260704000100). Same split as labor_cost_freeze
-- (20260623000000) and the status enums.
--
-- Enum-label pins to update in the same unit (grep-all-enum-pins lesson): the
-- full-label enum_has_labels on audit_action lives in
-- supabase/tests/database/03-audit-log-shape.test.sql and
-- 18-appsheet-writer-purchasing.test.sql. (File 19 references audit_action only
-- in a comment — no pin there.)

alter type public.audit_action add value 'dc_payment_recorded';
