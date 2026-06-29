-- ERD audit (2026-06-29) — finding M6. Reconcile inconsistent ON DELETE on the
-- money/evidence children of projects/work_packages.
--
-- The GL / AR / payroll cluster (journal_lines, client_billings,
-- retention_receivables, labor_logs, wp_labor_costs, equipment_usage_logs) is
-- already NO ACTION — a project/WP delete BLOCKS on them, forcing the operator
-- to handle the money trail explicitly. But the store-inventory ledger and the
-- frozen settlement/coin snapshots were ON DELETE CASCADE, so a break-glass
-- project hard-delete would SILENTLY destroy those equally-immutable money rows.
--
-- Operator decision (2026-06-29): reconcile to NO ACTION. Convert the
-- append-only store ledger (stock_receipts/counts/returns/reversals) and the
-- frozen economics snapshots (project_settlements, wp_profit_bank,
-- project_coin_distributions) to NO ACTION so they block deletion like the GL
-- cluster. The break-glass hard-delete playbook is updated to delete these
-- first (see memory prc-ops-project-hard-delete-playbook).
--
-- Mechanically: DROP each FK constraint and re-ADD it WITHOUT an ON DELETE
-- clause (= NO ACTION). No data change; the re-ADD validates against existing
-- rows (all already satisfy the FK). Atomic within this migration.
--
-- Left as-is (deliberately, out of the agreed set): stock_issues (mutable
-- custody, not pure append-only), stock_on_hand (derived, rebuildable cache),
-- purchase_requests / photo_logs / approvals (operational; delete_work_package
-- already guards on photos/approvals/PRs). Reconsider in a follow-up if desired.

-- stock_receipts.project_id ---------------------------------------------------
alter table public.stock_receipts drop constraint stock_receipts_project_id_fkey;
alter table public.stock_receipts add constraint stock_receipts_project_id_fkey
  foreign key (project_id) references public.projects(id);

-- stock_counts.project_id -----------------------------------------------------
alter table public.stock_counts drop constraint stock_counts_project_id_fkey;
alter table public.stock_counts add constraint stock_counts_project_id_fkey
  foreign key (project_id) references public.projects(id);

-- stock_returns.project_id + .work_package_id ---------------------------------
alter table public.stock_returns drop constraint stock_returns_project_id_fkey;
alter table public.stock_returns add constraint stock_returns_project_id_fkey
  foreign key (project_id) references public.projects(id);
alter table public.stock_returns drop constraint stock_returns_work_package_id_fkey;
alter table public.stock_returns add constraint stock_returns_work_package_id_fkey
  foreign key (work_package_id) references public.work_packages(id);

-- stock_reversals.project_id --------------------------------------------------
alter table public.stock_reversals drop constraint stock_reversals_project_id_fkey;
alter table public.stock_reversals add constraint stock_reversals_project_id_fkey
  foreign key (project_id) references public.projects(id);

-- project_settlements.project_id ----------------------------------------------
alter table public.project_settlements drop constraint project_settlements_project_id_fkey;
alter table public.project_settlements add constraint project_settlements_project_id_fkey
  foreign key (project_id) references public.projects(id);

-- wp_profit_bank.project_id ---------------------------------------------------
alter table public.wp_profit_bank drop constraint wp_profit_bank_project_id_fkey;
alter table public.wp_profit_bank add constraint wp_profit_bank_project_id_fkey
  foreign key (project_id) references public.projects(id);

-- project_coin_distributions.project_id ---------------------------------------
alter table public.project_coin_distributions drop constraint project_coin_distributions_project_id_fkey;
alter table public.project_coin_distributions add constraint project_coin_distributions_project_id_fkey
  foreign key (project_id) references public.projects(id);
