-- Spec 279 U1 / ADR 0079 — audit action for the crew lifecycle.
--
-- New enum value in its OWN migration file: Postgres forbids using a freshly
-- ADDed enum value in the same transaction that adds it, so this commits before
-- the crew RPCs (075410) reference it. Idempotent.
alter type public.audit_action add value if not exists 'crew_change';
