-- ERD audit (2026-06-29) — additive index hardening (findings M3, M4).
-- Both are CREATE INDEX only: no column change, no table rewrite, no db:types
-- churn. Brief SHARE lock on each table only (live audit 2026-06-29:
-- dc_payments = 0 rows, purchase_requests = 96 rows).
--
--   M3 (dc_payments): "one CURRENT payment per (worker, period)" was enforced
--       only inside record_dc_payment (pg_advisory_xact_lock + EXISTS). A
--       non-RPC writer (a future RPC, a data fix, a service-role script) could
--       insert a second non-superseded payment for the same period → double-pay.
--       Pin the invariant declaratively with a partial UNIQUE index over the
--       current (non-superseded) rows. Precheck confirmed 0 duplicate live
--       groups, so the index builds clean.
--
--   M4 (purchase_requests): item_price_history() (spec 182) filters
--       `where catalog_item_id = $1` with no other seekable predicate, but the
--       column was unindexed → a sequential scan of the largest mutable table.
--       The column is nullable and only non-null rows are ever looked up, so a
--       partial index keeps it small.

-- M3 — declarative double-pay guard.
create unique index if not exists dc_payments_one_current_per_period
  on public.dc_payments (worker_id, period_from, period_to)
  where superseded_by is null;

-- M4 — back the item_price_history() lookup.
create index if not exists purchase_requests_catalog_item_id_idx
  on public.purchase_requests (catalog_item_id)
  where catalog_item_id is not null;
