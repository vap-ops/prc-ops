-- Spec 146 U1 — equipment_items.daily_rate: the per-item charge-out rate PRC
-- sets, independent of the inbound batch cost (ADR 0055 decision 5, Case A).
--
-- MONEY POSTURE (copied from acquisition_cost / workers.day_rate): the existing
-- column-scoped authenticated grants on equipment_items (spec 141) enumerate the
-- NON-money columns. ALTER ADD COLUMN grants NOTHING to authenticated for the new
-- column, and we deliberately do NOT widen any grant here — so daily_rate is
-- admin-client-only out of the box (read behind requireRole(pm/super/procurement),
-- written only via set_equipment_daily_rate). Never on a site_admin screen
-- (spec 46). pgTAP file 67 asserts the anti-grant.

alter table public.equipment_items
  add column daily_rate numeric(12,2) null;

alter table public.equipment_items
  add constraint equipment_items_daily_rate_nonneg
    check (daily_rate is null or daily_rate >= 0);

comment on column public.equipment_items.daily_rate is
  'MONEY (spec 146 / ADR 0055): the per-item daily charge-out rate PRC sets (independent of the batch cost, Case A). NULL = not yet priced. No authenticated grant; admin-read only behind requireRole(pm/super/procurement); written via set_equipment_daily_rate. Never on a site_admin screen.';
