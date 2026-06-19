-- Spec 149 U5b / ADR 0057 decision 8 — audit_action values for retention
-- lifecycle. Enum-add isolation: own migration. Both pins (pgTAP 03 AND 18) updated.

alter type public.audit_action add value if not exists 'retention_due';
alter type public.audit_action add value if not exists 'retention_release';
