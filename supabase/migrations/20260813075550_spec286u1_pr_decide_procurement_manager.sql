-- Spec 286 U1 — procurement_manager may DECIDE (approve/reject) a requested PR.
-- Amends ADR 0070 item 3 (spec 261), which deliberately kept the approve
-- transition PM-tier only. Additive, transition-scoped UPDATE policy — mirrors
-- spec 261's "purchase_requests cancel by procurement_manager" exactly. The PM/
-- super policy ("purchase_requests update by pm or super") is UNTOUCHED, and
-- permissive UPDATE policies OR together, so this only ADDS the two transitions.
-- USING pins the OLD row to 'requested'; WITH CHECK pins the NEW row to
-- approved|rejected — so requested->purchased / requested->cancelled and any edit
-- of a non-requested row stay blocked for procurement_manager. No conditions
-- (Phase 1 unconditional; the amount cap is spec 286 Phase 2, super_admin-config).
create policy "purchase_requests decide by procurement_manager"
  on public.purchase_requests
  for update
  to authenticated
  using (
    (select public.current_user_role()) = 'procurement_manager'
    and status = 'requested'
  )
  with check (
    (select public.current_user_role()) = 'procurement_manager'
    and status in ('approved', 'rejected')
  );
