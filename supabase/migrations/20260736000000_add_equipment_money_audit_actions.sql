-- Spec 146 U1 — audit_action values for equipment money writes. Enum-add
-- isolation: their OWN migration (a new enum value cannot be used in the same
-- transaction that adds it), committed before the RPC migration that emits
-- them. Mirrors worker_change (20260619000100) and labor_cost_freeze
-- (20260623000000). pgTAP file 03's enum_has_labels pin is updated to match.

alter type public.audit_action add value if not exists 'equipment_rate_change';
alter type public.audit_action add value if not exists 'equipment_batch_create';
