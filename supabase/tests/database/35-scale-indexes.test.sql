-- Data-architecture hardening (rank 1+2): pin the indexes added by
-- 20260625000100_scale_indexes.sql so a future schema regen can't silently
-- drop them and re-introduce the seq scans the audit found.

begin;
select plan(8);

select has_index(
  'public', 'labor_logs', 'labor_logs_superseded_by_idx',
  'partial index on labor_logs.superseded_by exists (anti-join, mirrors photo_logs)'
);
select has_index(
  'public', 'labor_logs', 'labor_logs_work_date_idx',
  'work_date-leading index exists (spec-69 payroll date-window seek)'
);
select has_index(
  'public', 'purchase_requests', 'purchase_requests_requested_by_idx',
  'index on purchase_requests.requested_by exists (?mine filter + own-row RLS)'
);
select has_index(
  'public', 'purchase_requests', 'purchase_requests_supplier_id_idx',
  'index on purchase_requests.supplier_id exists (analytics link)'
);
select has_index(
  'public', 'work_packages', 'work_packages_status_updated_idx',
  '(status, updated_at) composite exists (PM landing filter+sort)'
);
select has_index(
  'public', 'work_packages', 'work_packages_contractor_id_idx',
  'index on work_packages.contractor_id exists (WP-owner FK)'
);
select has_index(
  'public', 'workers', 'workers_contractor_id_idx',
  'index on workers.contractor_id exists (DC payroll grouping FK)'
);
select has_index(
  'public', 'workers', 'workers_user_id_idx',
  'index on workers.user_id exists (self-log detection FK)'
);

select * from finish();
rollback;
