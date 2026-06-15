-- Spec 115 / ADR 0044 — audit action for create_purchase_order's PO-create row.
--
-- ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction that
-- adds it, so the value lands here (own migration) and the RPC that writes it
-- lives in the next migration (20260701000100). Same split as
-- labor_cost_freeze (20260623000000) and site_purchased.
--
-- The per-line ticket transition (approved → purchased) is audited by the
-- EXISTING purchase_requests_audit_appsheet trigger as 'purchase_request_purchase'
-- (mirrors record_purchase); this new value covers ONLY the one PO-create row.
--
-- Enum-label pins to update in the same unit (grep-all-enum-pins lesson):
-- supabase/tests/database/03-audit-log-shape.test.sql and
-- 18-appsheet-writer-purchasing.test.sql both assert the full audit_action
-- label set.

alter type public.audit_action add value 'purchase_order_create';
