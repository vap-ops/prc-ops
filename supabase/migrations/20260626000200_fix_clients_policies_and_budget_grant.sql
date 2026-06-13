-- Spec 79 correction — two fixes to 20260626000000/000100, applied as a
-- follow-up because those versions are already in the remote migration history.
--
-- 1. The clients policies called public.current_user_role() BARE. The
--    eval-once doctrine (rls_eval_once, pgTAP file 40) requires it wrapped in a
--    scalar subselect so the planner evaluates it once per query, not per row.
--    Re-create the three policies wrapped.
--
-- 2. budget_amount_thb SELECT was revoked at the COLUMN level, but `authenticated`
--    holds a TABLE-level SELECT grant on projects, so the column revoke was inert
--    (has_column_privilege stayed true). Replace the table-level grant with
--    explicit per-column SELECT grants for every column EXCEPT budget_amount_thb.
--    MONEY stays unreadable by authenticated; PM/super read it via the admin
--    client behind requireRole (Spec 68 pattern).
--    MAINTENANCE: any future projects column must be added to this grant — a new
--    column is otherwise unreadable by the app — UNLESS it is money, in which case
--    it is intentionally omitted (like budget_amount_thb).

-- 1. clients policies — eval-once wrap.
drop policy "clients readable by staff"           on public.clients;
drop policy "clients insert by pm or super_admin" on public.clients;
drop policy "clients update by pm or super_admin" on public.clients;

create policy "clients readable by staff"
  on public.clients for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'super_admin'));

create policy "clients insert by pm or super_admin"
  on public.clients for insert to authenticated
  with check ((select public.current_user_role()) in ('project_manager', 'super_admin')
              and created_by = (select auth.uid()));

create policy "clients update by pm or super_admin"
  on public.clients for update to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin'))
  with check ((select public.current_user_role()) in ('project_manager', 'super_admin'));

-- 2. budget money isolation via explicit per-column SELECT grants.
revoke select on public.projects from authenticated;
grant select (
  id, code, name, status, created_at, updated_at, notes,
  site_address, contract_reference, start_date, planned_completion_date,
  client_id, project_lead_id, project_type
) on public.projects to authenticated;
-- budget_amount_thb deliberately omitted — MONEY, admin-client read only.
