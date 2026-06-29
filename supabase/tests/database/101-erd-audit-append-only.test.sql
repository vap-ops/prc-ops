begin;
select plan(10);

-- ============================================================================
-- ERD audit (2026-06-29) — finding M7. Four store-ledger tables and
-- equipment_movements were "append-only" via only TWO layers (REVOKE + RLS
-- with no UPDATE/DELETE policy). (stock_issues is excluded — it has a
-- legitimate custody UPDATE; see the migration's SCOPE CORRECTION note.) Every writer is a postgres-owned SECURITY
-- DEFINER RPC, so REVOKE does not constrain that path — only a BEFORE
-- UPDATE/DELETE trigger does (the layer-3 backstop that labor_logs / photo_logs
-- / dc_payments / equipment_usage_logs already carry). A re-sourced
-- CREATE OR REPLACE definer bug (a trap this repo has hit on the GL drain)
-- could otherwise silently mutate an immutable money/custody row.
--
-- This pins the layer-3 trigger (BEFORE UPDATE OR DELETE + BEFORE TRUNCATE) on
-- all six. A present trigger implies its block-mutation function exists (a
-- trigger cannot reference a missing function), so existence is a sound
-- regression guard; the function body is the verbatim gold-standard
-- `raise exception ... errcode 'P0001'` mirrored from labor_logs.
-- ============================================================================

select has_trigger('public', 'stock_receipts', 'stock_receipts_no_update_delete',
  'M7: stock_receipts UPDATE/DELETE blocked by trigger');
select has_trigger('public', 'stock_receipts', 'stock_receipts_no_truncate',
  'M7: stock_receipts TRUNCATE blocked by trigger');

select has_trigger('public', 'stock_counts', 'stock_counts_no_update_delete',
  'M7: stock_counts UPDATE/DELETE blocked by trigger');
select has_trigger('public', 'stock_counts', 'stock_counts_no_truncate',
  'M7: stock_counts TRUNCATE blocked by trigger');

select has_trigger('public', 'stock_returns', 'stock_returns_no_update_delete',
  'M7: stock_returns UPDATE/DELETE blocked by trigger');
select has_trigger('public', 'stock_returns', 'stock_returns_no_truncate',
  'M7: stock_returns TRUNCATE blocked by trigger');

select has_trigger('public', 'stock_reversals', 'stock_reversals_no_update_delete',
  'M7: stock_reversals UPDATE/DELETE blocked by trigger');
select has_trigger('public', 'stock_reversals', 'stock_reversals_no_truncate',
  'M7: stock_reversals TRUNCATE blocked by trigger');

select has_trigger('public', 'equipment_movements', 'equipment_movements_no_update_delete',
  'M7: equipment_movements UPDATE/DELETE blocked by trigger');
select has_trigger('public', 'equipment_movements', 'equipment_movements_no_truncate',
  'M7: equipment_movements TRUNCATE blocked by trigger');

select * from finish();
rollback;
