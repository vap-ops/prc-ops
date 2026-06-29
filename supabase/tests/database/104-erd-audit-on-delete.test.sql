begin;
select plan(9);

-- ============================================================================
-- ERD audit (2026-06-29) — finding M6. The append-only store ledger and the
-- frozen settlement/coin snapshots now block a project/WP delete (ON DELETE
-- NO ACTION = confdeltype 'a'), matching the GL/AR/payroll cluster, instead of
-- silently cascading away immutable money/evidence rows. Pin each child's
-- referential action so it cannot regress to CASCADE.
-- ============================================================================

create or replace function pg_temp.confdel(p_conname text) returns "char"
language sql stable as $$ select confdeltype from pg_constraint where conname = p_conname $$;

select is(pg_temp.confdel('stock_receipts_project_id_fkey'), 'a'::"char",
  'M6: stock_receipts.project_id is NO ACTION');
select is(pg_temp.confdel('stock_counts_project_id_fkey'), 'a'::"char",
  'M6: stock_counts.project_id is NO ACTION');
select is(pg_temp.confdel('stock_returns_project_id_fkey'), 'a'::"char",
  'M6: stock_returns.project_id is NO ACTION');
select is(pg_temp.confdel('stock_returns_work_package_id_fkey'), 'a'::"char",
  'M6: stock_returns.work_package_id is NO ACTION');
select is(pg_temp.confdel('stock_reversals_project_id_fkey'), 'a'::"char",
  'M6: stock_reversals.project_id is NO ACTION');
select is(pg_temp.confdel('project_settlements_project_id_fkey'), 'a'::"char",
  'M6: project_settlements.project_id is NO ACTION');
select is(pg_temp.confdel('wp_profit_bank_project_id_fkey'), 'a'::"char",
  'M6: wp_profit_bank.project_id is NO ACTION');
select is(pg_temp.confdel('project_coin_distributions_project_id_fkey'), 'a'::"char",
  'M6: project_coin_distributions.project_id is NO ACTION');

-- Guard the contrast: a GL child stays NO ACTION (it always was) — proves we
-- read the right signal and did not flip the whole table set.
select is(pg_temp.confdel('wp_profit_bank_work_package_id_fkey'), 'a'::"char",
  'M6: wp_profit_bank.work_package_id remains NO ACTION');

select * from finish();
rollback;
