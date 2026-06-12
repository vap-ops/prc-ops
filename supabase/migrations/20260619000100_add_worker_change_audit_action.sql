-- Spec 46 — audit_action value for worker-master changes (create /
-- update / rate change; payload.kind discriminates). Separate migration:
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- references the new value (20260608140000 precedent).

alter type public.audit_action add value 'worker_change';
