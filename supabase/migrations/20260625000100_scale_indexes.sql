-- Data-architecture hardening (rank 1+2) — index the hot read paths the
-- audit surfaced as seq scans. Pure additive DDL; no behavior change.
--
-- labor_logs: the supersede anti-join (NOT EXISTS newer.superseded_by = ll.id)
-- runs in freeze_wp_labor_cost, every payroll/cost read, and the cross-WP
-- over-allocation check, but superseded_by was unindexed (photo_logs already
-- has its partial twin, 20260524020000). Separately, the spec-69 payroll query
-- windows on work_date ALONE (no worker/wp predicate), and both existing
-- composites lead with worker_id / work_package_id, so a pure date range could
-- not seek either — it full-scanned every period. A work_date-leading index
-- fixes that path.
create index if not exists labor_logs_superseded_by_idx
  on public.labor_logs (superseded_by)
  where superseded_by is not null;

create index if not exists labor_logs_work_date_idx
  on public.labor_logs (work_date);

-- purchase_requests: requested_by drives the /requests ?mine filter and the
-- own-row RLS branch; supplier_id is the analytics link. (status is already
-- covered by purchase_requests_status_requested_at_idx.)
create index if not exists purchase_requests_requested_by_idx
  on public.purchase_requests (requested_by);

create index if not exists purchase_requests_supplier_id_idx
  on public.purchase_requests (supplier_id);

-- work_packages: the PM landing queries status='pending_approval' ORDER BY
-- updated_at — a (status, updated_at) composite serves filter + sort in one
-- seek. contractor_id is the WP-owner FK (spec 31), unindexed.
create index if not exists work_packages_status_updated_idx
  on public.work_packages (status, updated_at);

create index if not exists work_packages_contractor_id_idx
  on public.work_packages (contractor_id);

-- workers: contractor_id (DC payroll grouping) and user_id (self-log
-- detection) are FK lookups Postgres does not auto-index.
create index if not exists workers_contractor_id_idx
  on public.workers (contractor_id);

create index if not exists workers_user_id_idx
  on public.workers (user_id);
