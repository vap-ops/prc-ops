-- Spec 245 U1 fix — RLS policy naming (ADR 0058 / spec 152 U3 convention).
--
-- Migration 20260813048000 added a project_manager-only branch to 2 RLS
-- policies (supply_plans / supply_plan_lines, is_template read). Its
-- on-disk file content was already corrected (post-review) to check both
-- project_manager and project_director, satisfying the codebase-wide
-- "every RLS policy naming project_manager also names project_director"
-- completeness convention (pgTAP 91-project-director-write-rls.test.sql
-- assertion 1) — but that edit never reached the LIVE database:
-- `supabase db push` treats an already-recorded migration timestamp as
-- applied and silently skips re-running an edited file's body. This
-- migration is the actual patch that lands on the live DB. 048000's file
-- content is kept in its corrected form (matching this migration's result)
-- so a FRESH database setup gets it right on the first pass, with no
-- follow-up needed.

alter policy "supply_plans readable by project viewers"
  on public.supply_plans
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
    or (is_template and (select public.current_user_role()) in ('project_manager', 'project_director'))
  );

alter policy "supply_plan_lines readable by project viewers"
  on public.supply_plan_lines
  using (
    (select public.current_user_role()) = 'procurement'
    or exists (
      select 1 from public.supply_plans sp
       where sp.id = supply_plan_id
         and (
           public.can_see_project(sp.project_id)
           or (sp.is_template and (select public.current_user_role()) in ('project_manager', 'project_director'))
         )
    )
  );
