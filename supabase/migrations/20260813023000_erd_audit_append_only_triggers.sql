-- ERD audit (2026-06-29) — finding M7. Add the layer-3 append-only backstop
-- (BEFORE UPDATE/DELETE + BEFORE TRUNCATE trigger) to four store-ledger tables
-- and equipment_movements, which had only layers 1 (REVOKE) + 2 (RLS with no
-- UPDATE/DELETE policy).
--
-- SCOPE CORRECTION (verified pre-push): stock_issues is DELIBERATELY excluded.
-- It is NOT pure append-only — confirm_stock_issue / confirm_on_behalf
-- legitimately UPDATE its custody columns (received_at / received_by; see
-- 20260809000300_spec177u6_custody.sql:168, 20260809001800_spec178b5...:64). A
-- blanket block trigger would break custody confirmation. Its ledger fields
-- (qty/cost) DO still want protection — that needs a COLUMN-SCOPED trigger
-- (freeze cost/qty, allow custody), tracked as follow-up M7b, not this PR.
--
-- Why it matters: every writer to these tables is a postgres-owned SECURITY
-- DEFINER RPC. REVOKE and RLS do NOT constrain that owner path — only a trigger
-- does. The money/photo/payroll tables (labor_logs, photo_logs, dc_payments,
-- equipment_usage_logs, journal_*, audit_log) all already carry this trigger;
-- these six were the gap. A re-sourced CREATE OR REPLACE definer bug (the exact
-- trap hit on the GL drain, fixed in 20260813007000) could otherwise silently
-- UPDATE/DELETE an immutable inventory/custody/GL-source row with no backstop.
--
-- Pattern mirrors the labor_logs gold standard (20260619000300:66-82): a
-- per-table block-mutation function raising errcode 'P0001', a FOR EACH ROW
-- BEFORE UPDATE OR DELETE trigger, and a FOR EACH STATEMENT BEFORE TRUNCATE
-- trigger. INSERT is untouched (the existing AFTER INSERT GL-enqueue /
-- derive-status triggers keep firing). Corrections remain new rows
-- (stock_reversals / stock_returns / supersede), never in-place edits.
--
-- NOTE for break-glass: like the other append-only tables, an operator teardown
-- that must delete these rows has to disable the trigger inside the guarded
-- transaction (docs/break-glass.md Procedure A) — that is the intended cost.

-- stock_receipts -------------------------------------------------------------
create function public.stock_receipts_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_receipts is append-only (correct via reversal, never mutate): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger stock_receipts_no_update_delete
  before update or delete on public.stock_receipts
  for each row execute function public.stock_receipts_block_mutation();
create trigger stock_receipts_no_truncate
  before truncate on public.stock_receipts
  for each statement execute function public.stock_receipts_block_mutation();

-- stock_counts ---------------------------------------------------------------
create function public.stock_counts_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_counts is append-only (correct via reversal, never mutate): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger stock_counts_no_update_delete
  before update or delete on public.stock_counts
  for each row execute function public.stock_counts_block_mutation();
create trigger stock_counts_no_truncate
  before truncate on public.stock_counts
  for each statement execute function public.stock_counts_block_mutation();

-- stock_returns --------------------------------------------------------------
create function public.stock_returns_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_returns is append-only (correct via reversal, never mutate): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger stock_returns_no_update_delete
  before update or delete on public.stock_returns
  for each row execute function public.stock_returns_block_mutation();
create trigger stock_returns_no_truncate
  before truncate on public.stock_returns
  for each statement execute function public.stock_returns_block_mutation();

-- stock_reversals ------------------------------------------------------------
create function public.stock_reversals_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_reversals is append-only (a reversal is itself the correction): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger stock_reversals_no_update_delete
  before update or delete on public.stock_reversals
  for each row execute function public.stock_reversals_block_mutation();
create trigger stock_reversals_no_truncate
  before truncate on public.stock_reversals
  for each statement execute function public.stock_reversals_block_mutation();

-- equipment_movements --------------------------------------------------------
create function public.equipment_movements_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'equipment_movements is append-only (custody ledger, never mutate): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger equipment_movements_no_update_delete
  before update or delete on public.equipment_movements
  for each row execute function public.equipment_movements_block_mutation();
create trigger equipment_movements_no_truncate
  before truncate on public.equipment_movements
  for each statement execute function public.equipment_movements_block_mutation();
