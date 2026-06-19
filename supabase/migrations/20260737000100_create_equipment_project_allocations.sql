-- Spec 146 U2 — equipment_project_allocations: where a rented set's monthly cost
-- is committed. A rental batch (equipment_rental_batches) attached to a PROJECT
-- for a period (ADR 0055 decisions 4/8). MONEY DOMAIN: the allocation links a
-- project to a money batch, so it gets the U1 zero-grant posture.
--
-- Two axes stay separate (decision 4): PHYSICAL custody = equipment_movements
-- (item deployed-to-project, field-visible); MONEY commitment = this table
-- (batch -> project, admin-only). Under Case A (independent per-item daily
-- charge-out, not a pass-through of the monthly cost) the allocation needs no
-- per-item membership or quantity — whole-batch-to-project only. Bulk/partial
-- split is the deferred reconciliation seam.
--
-- Zero grant (money): RLS enabled then REVOKE ALL — written only by the
-- SECURITY DEFINER RPC below, read only via the admin client behind
-- requireRole(pm/super/procurement). NO delete (a commitment is permanent
-- history; an ended allocation carries ends_on).

create table public.equipment_project_allocations (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.equipment_rental_batches(id),
  project_id uuid not null references public.projects(id),
  starts_on  date not null,
  ends_on    date null,
  note       text null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint equipment_project_allocations_period_order
    check (ends_on is null or ends_on >= starts_on)
);

create index equipment_project_allocations_project_idx
  on public.equipment_project_allocations (project_id);
create index equipment_project_allocations_batch_idx
  on public.equipment_project_allocations (batch_id);

alter table public.equipment_project_allocations enable row level security;
-- Zero grant: money. Written only by the SECURITY DEFINER RPC below; read only
-- via the admin client. No authenticated grant => no policy to write (RLS stays
-- enabled per the project rule). No delete grant/policy.
revoke all on public.equipment_project_allocations from anon, authenticated;

comment on table public.equipment_project_allocations is
  'Equipment rental project allocation (spec 146 / ADR 0055): commits a rental batch (equipment_rental_batches, its monthly cost) to a project for a period. MONEY domain: zero authenticated grant, admin-read only, written via create_equipment_project_allocation. Physical item->project custody is equipment_movements (field-visible); this is the money commitment (admin-only). Whole-batch-to-project (Case A); no per-item membership/quantity. No delete.';
