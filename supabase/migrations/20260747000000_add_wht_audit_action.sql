-- Spec 149 U6 / ADR 0057 decision 9 — audit_action for WHT certificate recording.
-- Enum-add isolation: own migration. Both pins (pgTAP 03 AND 18) updated.

alter type public.audit_action add value if not exists 'wht_certificate_record';
