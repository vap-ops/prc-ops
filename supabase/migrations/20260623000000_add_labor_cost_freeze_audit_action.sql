-- Spec 68 P2 — audit action for freeze_wp_labor_cost.
--
-- ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction
-- that adds it, so the value lands here (own migration) and the RPC that
-- writes it lives in the next migration (20260623000100). Same split the
-- enum-adding migrations elsewhere use (e.g. site_purchased status).
--
-- Enum-label pins to update in the same unit (grep-all-enum-pins lesson):
-- supabase/tests/database/03-audit-log-shape.test.sql and
-- 18-appsheet-writer-purchasing.test.sql both assert the full audit_action
-- label set.

alter type public.audit_action add value 'labor_cost_freeze';
