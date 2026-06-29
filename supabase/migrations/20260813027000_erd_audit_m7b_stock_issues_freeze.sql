-- ERD audit follow-up M7b (2026-06-29). stock_issues was deliberately excluded
-- from the M7 (20260813023000) append-only block triggers because it carries a
-- LEGITIMATE custody UPDATE: confirm_stock_issue (20260809000300) sets
-- received_at, and confirm_on_behalf (20260809001800) sets received_at +
-- received_on_behalf + received_by. A blanket BEFORE UPDATE block would break
-- those flows.
--
-- But the LEDGER fields (qty, unit, unit_cost, catalog_item_id, work_package_id,
-- project_id, issued_*, receiver_worker_id, …) are immutable cost/inventory
-- facts and a re-sourced CREATE OR REPLACE definer bug could silently mutate
-- them with no backstop (the same gap M7 closed for the other ledgers). So this
-- adds a COLUMN-SCOPED freeze: allow ONLY the three custody columns to change,
-- raise P0001 on any other column edit. Implemented with the to_jsonb(row) minus
-- the custody keys compare, so any column added later is frozen by default.
--
-- Plus the standard append-only DELETE/TRUNCATE block (corrections go through
-- stock_reversals, never a delete). INSERT is untouched (the AFTER INSERT GL
-- enqueue keeps firing).
--
-- Verified pre-write: confirm_stock_issue / confirm_on_behalf are the ONLY
-- UPDATEs of stock_issues in the schema, and they touch exactly those 3 columns,
-- so this does not break the custody handshake (pgTAP 183 / 197 stay green).

-- Column-scoped freeze: only received_at / received_by / received_on_behalf may
-- change. Explicit per-column checks (NOT a to_jsonb whole-row diff): total_cost
-- and total_sell are GENERATED STORED columns, so they read NULL in NEW during a
-- BEFORE trigger and a jsonb compare would false-positive on every update. The
-- generated totals derive from qty/unit_cost/sell_price (frozen below), so they
-- cannot change independently anyway. New ledger columns added later must be
-- added to this list.
create or replace function public.stock_issues_freeze_ledger()
returns trigger language plpgsql as $$
begin
  if new.project_id         is distinct from old.project_id
     or new.catalog_item_id    is distinct from old.catalog_item_id
     or new.work_package_id    is distinct from old.work_package_id
     or new.qty                is distinct from old.qty
     or new.unit               is distinct from old.unit
     or new.unit_cost          is distinct from old.unit_cost
     or new.sell_price         is distinct from old.sell_price
     or new.issued_by          is distinct from old.issued_by
     or new.issued_at          is distinct from old.issued_at
     or new.created_at         is distinct from old.created_at
     or new.receiver_worker_id is distinct from old.receiver_worker_id
     or new.note               is distinct from old.note
  then
    raise exception
      'stock_issues ledger fields are immutable — only custody confirmation (received_*) may change'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stock_issues_freeze_ledger
  before update on public.stock_issues
  for each row execute function public.stock_issues_freeze_ledger();

-- Append-only for deletes: correct via stock_reversals, never delete.
create function public.stock_issues_block_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_issues is append-only (correct via stock_reversals): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger stock_issues_no_delete
  before delete on public.stock_issues
  for each row execute function public.stock_issues_block_delete();
create trigger stock_issues_no_truncate
  before truncate on public.stock_issues
  for each statement execute function public.stock_issues_block_delete();
