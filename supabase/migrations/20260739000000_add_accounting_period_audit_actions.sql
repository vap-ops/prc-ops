-- Spec 149 U2 / ADR 0057 — audit_action values for accounting-period lifecycle.
-- Enum-add isolation: their own migration (a new enum value cannot be used in the
-- same transaction that adds it). Both enum_has_labels pins (pgTAP file 03 AND
-- file 18) are updated to match — the spec 146 lesson, re-applied.

alter type public.audit_action add value if not exists 'accounting_period_open';
alter type public.audit_action add value if not exists 'accounting_period_status_change';
