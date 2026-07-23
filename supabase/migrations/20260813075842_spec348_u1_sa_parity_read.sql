-- Spec 348 U1 / ADR 0084 — procurement_manager gains SEE-ALL project visibility.
--
-- The procurement manager trains + supports the site admins and must SEE every
-- SA surface on every project. This unit grants the READ half:
--
--   1. can_see_project() — add procurement_manager to the SEE-ALL arm (alongside
--      super_admin / project_coordinator / project_director). She becomes a full
--      peer of project_director for VISIBILITY. This single helper is the read
--      gate behind the muster_*, daily_work_plans, work_packages and every other
--      can_see_project-scoped SELECT policy, so widening it here opens all of
--      them at once.
--   2. The six cross-project staff-read SELECT policies that used the bare
--      SITE_STAFF array (site_admin/pm/super/pd) and therefore excluded her.
--
-- DIRECTIONAL: only procurement_manager is added. Plain `procurement` gains
-- nothing (it is nowhere in can_see_project, and stays out of the six policies).
-- site_admin is untouched.
--
-- WRITE CONSEQUENCE (operator decision 2026-07-23, "match project_director"):
-- because the eight crew RPCs and submit_receipt_correction_request gate on
-- is_back_office / membership + can_see_project, and procurement_manager is
-- is_back_office, the see-all grant ALSO lets her run those on any project —
-- exactly as project_director already can. Spec 332 U3c had blocked procurement
-- there only because can_see_project returned false for it; that block lifts for
-- procurement_manager (only). No crew/receipt RPC is edited — the change is a
-- pure consequence of the helper. The 279 create_crew denial assert for this
-- role is updated to lives_ok in the same PR.
--
-- is_site_staff() is NOT widened here: it gates zero SELECT policies (it does
-- nothing for reads) and is consumed only by write RPCs — it belongs to U3
-- (write parity). audit_log's rework-events reader already admits
-- procurement_manager (verified live) — no change.
--
-- Sourced from the LIVE definitions (never a migration file). Policy recreations
-- preserve the (select current_user_role()) initplan wrapper (guard
-- 40-rls-eval-once). can_see_project keeps its grants across CREATE OR REPLACE.

-- ── 1. can_see_project: procurement_manager joins the see-all arm ────────────
create or replace function public.can_see_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when public.current_user_role() in
      ('super_admin', 'project_coordinator', 'project_director', 'procurement_manager') then true
    when public.current_user_role() in
      ('project_manager', 'site_admin', 'site_owner', 'auditor') then (
      exists (
        select 1 from public.project_members m
         where m.project_id = p_project_id and m.user_id = auth.uid()
      )
      or exists (
        select 1 from public.projects p
         where p.id = p_project_id and p.project_lead_id = auth.uid()
      )
    )
    else false
  end
$function$;

-- ── 2. The six cross-project staff-read SELECT policies ──────────────────────
-- Each used the bare SITE_STAFF array; add procurement_manager. drop+create is a
-- REWRITE, so the (select current_user_role()) initplan wrapper is reproduced.

drop policy if exists "clients readable by staff" on public.clients;
create policy "clients readable by staff" on public.clients
  for select to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'
    ]::public.user_role[])
  );

drop policy if exists "contractor_consents readable by staff" on public.contractor_consents;
create policy "contractor_consents readable by staff" on public.contractor_consents
  for select to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'
    ]::public.user_role[])
  );

drop policy if exists "service_providers readable by staff" on public.service_providers;
create policy "service_providers readable by staff" on public.service_providers
  for select to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'
    ]::public.user_role[])
  );

drop policy if exists "members readable by privileged roles" on public.work_package_members;
create policy "members readable by privileged roles" on public.work_package_members
  for select to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'
    ]::public.user_role[])
  );

drop policy if exists "subcontract_crew_members_select_pm_sa" on public.subcontract_crew_members;
create policy "subcontract_crew_members_select_pm_sa" on public.subcontract_crew_members
  for select to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'
    ]::public.user_role[])
    and public.can_see_subcontract(subcontract_id)
  );

drop policy if exists "subcontract_crew_attachments_select_pm_sa" on public.subcontract_crew_attachments;
create policy "subcontract_crew_attachments_select_pm_sa" on public.subcontract_crew_attachments
  for select to authenticated
  using (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'
    ]::public.user_role[])
    and exists (
      select 1 from public.subcontract_crew_members m
       where m.id = subcontract_crew_attachments.crew_member_id
         and public.can_see_subcontract(m.subcontract_id)
    )
  );
