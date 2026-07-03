-- Spec 260 U1e — hardening fix for purchase_order_charges (created in 070600,
-- already applied → forward fix, never edit an applied migration). Two gaps the
-- full pgTAP run caught:
--
-- 1. Grants. Supabase's default privileges grant authenticated + anon FULL DML
--    on a new public table, so 070600's lone `grant select` left INSERT/UPDATE/
--    DELETE in place. RLS still denied every write (the table has no write
--    policy), but the money posture (ADR 0038/0044 §6, mirrored from
--    purchase_orders) is "zero write grant" as defense-in-depth — and the pgTAP
--    grant pins enforce it. Revoke everything, then re-grant SELECT to
--    authenticated only (anon gets nothing — a money table).
--
-- 2. Eval-once. 070600's SELECT policy called public.current_user_role() BARE;
--    the repo convention (ADR 0021, the 40-rls-eval-once pin) wraps it in a
--    scalar subselect so the planner evaluates it once per query, not per row.
--    Re-create the policy in the wrapped form (matches purchase_orders exactly).

revoke all on public.purchase_order_charges from anon, authenticated;
grant select on public.purchase_order_charges to authenticated;

drop policy if exists "purchase_order_charges readable by back office"
  on public.purchase_order_charges;
create policy "purchase_order_charges readable by back office"
  on public.purchase_order_charges for select
  to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'procurement',
      'super_admin', 'project_director']::public.user_role[])
  );
