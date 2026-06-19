-- Spec 149 U1 / ADR 0057 — audit_action value for chart-of-accounts maintenance.
-- Enum-add isolation: its own migration (a new enum value cannot be used in the
-- same transaction that adds it). Both enum_has_labels pins (pgTAP file 03 AND
-- file 18) are updated to match — the spec 146 lesson, re-applied.

alter type public.audit_action add value if not exists 'gl_account_upsert';
