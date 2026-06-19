-- Spec 146 U2 — audit_action value for equipment project-allocation creation.
-- Enum-add isolation: its own migration (a new enum value cannot be used in the
-- same transaction that adds it). Both enum_has_labels pins (pgTAP file 03 AND
-- file 18) are updated to match — the U1 lesson, re-applied.

alter type public.audit_action add value if not exists 'equipment_allocation_create';
