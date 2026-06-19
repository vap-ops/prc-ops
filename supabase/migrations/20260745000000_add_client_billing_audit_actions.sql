-- Spec 149 U5 / ADR 0057 decision 8 — audit_action values for client billing.
-- Enum-add isolation: own migration. Both enum_has_labels pins (pgTAP 03 AND 18)
-- updated.

alter type public.audit_action add value if not exists 'client_billing_create';
alter type public.audit_action add value if not exists 'client_billing_certify';
