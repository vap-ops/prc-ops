begin;
select plan(5);

-- ============================================================================
-- ERD audit (2026-06-29) — additive index hardening. Pins the two pure-additive
-- index findings from the multi-agent ERD audit so they cannot silently regress.
-- ============================================================================

-- M4 — purchase_requests.catalog_item_id backs item_price_history() (spec 182),
-- which filters on this column alone. Without the index it seq-scans the largest
-- mutable table.
select has_index(
  'public', 'purchase_requests', 'purchase_requests_catalog_item_id_idx',
  'M4: purchase_requests_catalog_item_id_idx exists'
);
select is(
  (select i.indpred is not null
     from pg_class c join pg_index i on i.indexrelid = c.oid
     where c.relname = 'purchase_requests_catalog_item_id_idx'),
  true,
  'M4: catalog_item_id index is partial (WHERE catalog_item_id IS NOT NULL)'
);

-- M3 — "one CURRENT dc_payment per (worker, period)" was enforced only inside
-- record_dc_payment (advisory lock + EXISTS). Pin it declaratively with a partial
-- UNIQUE index so no non-RPC writer can double-pay a period.
select has_index(
  'public', 'dc_payments', 'dc_payments_one_current_per_period',
  'M3: dc_payments_one_current_per_period exists'
);
select index_is_unique(
  'public', 'dc_payments', 'dc_payments_one_current_per_period'
);
select is(
  (select i.indpred is not null
     from pg_class c join pg_index i on i.indexrelid = c.oid
     where c.relname = 'dc_payments_one_current_per_period'),
  true,
  'M3: the period unique index is partial (WHERE superseded_by IS NULL)'
);

select * from finish();
rollback;
