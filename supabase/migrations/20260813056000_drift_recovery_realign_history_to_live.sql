-- Drift recovery (docs/policies/change-management.md §4) — re-assert five live
-- objects VERBATIM from prod so the migration record's LAST definition of each
-- matches what actually runs. Semantic NO-OP on prod (sourced from LIVE
-- 2026-07-02 via pg_get_functiondef / pg_policies / pg_proc.proacl). As-built
-- account: ADR 0069.
--
-- What drifted: for four applied migrations the RECORDED statements in
-- supabase_migrations.schema_migrations differ from the committed files — the
-- files were edited in place AFTER apply (an in-place edit never re-runs;
-- prod was instead fixed forward out-of-band):
--
--   1. 20260813027000 stock_issues_freeze_ledger — recorded body is the
--      to_jsonb whole-row diff (false-positives on GENERATED STORED
--      total_cost/total_sell, which read NULL in NEW during a BEFORE trigger);
--      prod was fixed forward to explicit per-column checks. Replay-visible
--      residue today: live prosrc carries the explanatory comments INSIDE the
--      body, the file's version outside → a pg_get_functiondef diff on every
--      replay audit.
--   2. 20260525010000 claim_next_report — recorded statements revoke EXECUTE
--      only FROM PUBLIC, which left the anon/authenticated default-privilege
--      grants in place at apply time; prod was later locked to
--      service_role-only. (The body was always FIFO — order by created_at +
--      for update skip locked.)
--   3. 20260809001200 policy "purchase_quotes readable by back office" —
--      recorded role list lacks project_director; prod gained it out-of-band.
--      pgTAP 91 pins the live posture.
--   4/5. 20260809000000 stock_on_hand / stock_receipts read policies —
--      recorded qual calls current_user_role() bare; prod was rewritten to the
--      (select …) eval-once form. pgTAP 40 pins it.

-- ---------------------------------------------------------------------------
-- 1) stock_issues_freeze_ledger — LIVE body verbatim (comments inside the
--    body included, so a replayed prosrc equals prod's prosrc byte-for-byte).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_issues_freeze_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Freeze the ledger/identity columns; allow only the custody columns
  -- (received_at/received_by/received_on_behalf). Explicit per-column checks
  -- (NOT a to_jsonb diff): total_cost/total_sell are GENERATED STORED, so they
  -- read NULL in NEW during a BEFORE trigger and a whole-row jsonb compare
  -- false-positives. The generated totals derive from qty/unit_cost/sell_price,
  -- which ARE frozen here, so they cannot change independently anyway.
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
$function$;

-- ---------------------------------------------------------------------------
-- 2) claim_next_report — LIVE body verbatim + re-assert the live ACL
--    (EXECUTE: owner + service_role only; the Railway worker is the sole
--    caller — app sessions must never claim worker jobs).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_next_report()
 RETURNS SETOF reports
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.reports
     set status     = 'processing',
         updated_at = now()
   where id = (
     select id
       from public.reports
      where status = 'requested'
      order by created_at
      limit 1
      for update skip locked
   )
   returning *;
$function$;

revoke execute on function public.claim_next_report() from public, anon, authenticated;
grant execute on function public.claim_next_report() to service_role;

-- ---------------------------------------------------------------------------
-- 3) purchase_quotes back-office read — LIVE role list (incl.
--    project_director, the spec-152 back-office tier).
-- ---------------------------------------------------------------------------
drop policy if exists "purchase_quotes readable by back office" on public.purchase_quotes;
create policy "purchase_quotes readable by back office"
  on public.purchase_quotes for select to authenticated
  using (
    (select public.current_user_role()) in
      ('project_manager', 'procurement', 'super_admin', 'project_director')
  );

-- ---------------------------------------------------------------------------
-- 4/5) stock_receipts / stock_on_hand read — LIVE (select …)-wrapped
--      eval-once qual.
-- ---------------------------------------------------------------------------
drop policy if exists "stock_receipts readable by project viewers or procurement" on public.stock_receipts;
create policy "stock_receipts readable by project viewers or procurement"
  on public.stock_receipts for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );

drop policy if exists "stock_on_hand readable by project viewers or procurement" on public.stock_on_hand;
create policy "stock_on_hand readable by project viewers or procurement"
  on public.stock_on_hand for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );
