-- Spec 143 U3 / ADR 0056 — complete the membership-scoping U1 (20260728000000)
-- left incomplete. A lifecycle audit found three project-scoped child tables
-- whose SELECT was still role-level (cross-project leak to PM/site_admin), and
-- that the SELECT-only U1 left the app write policies role-level too (a
-- non-member could write a row for a project they cannot read).
--
-- This migration:
--   1. Adds can_see_photo_log(uuid) (photo_log → WP → can_see_wp).
--   2. Scopes the three leaked SELECTs: photo_markups, labor_logs (staff
--      policy only — the bound-contractor self-read is untouched),
--      work_package_dependencies.
--   3. Mirrors the membership gate onto the eight app write policies, KEEPING
--      each existing role list (so project_coordinator — read-only oversight —
--      stays out of writes; super stays in via the helper). The RPC-only write
--      paths (labor_logs, wp_dependencies) are gated by their SECURITY DEFINER
--      RPCs and are not changed here.
--
-- Writes by a legitimate member pass (can_see_* = true); admin-client writes
-- bypass RLS; non-members were already read-locked — so no working flow
-- regresses. Eval-once wrapped form throughout (pgTAP file 40).

-- ----------------------------------------------------------------------------
-- Helper.
-- ----------------------------------------------------------------------------
create function public.can_see_photo_log(p_photo_log_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select public.can_see_wp(pl.work_package_id)
       from public.photo_logs pl
      where pl.id = p_photo_log_id),
    false)
$$;

revoke all on function public.can_see_photo_log(uuid) from public, anon;
grant execute on function public.can_see_photo_log(uuid) to authenticated;

comment on function public.can_see_photo_log(uuid) is
  'ADR 0056 — can_see_wp for a photo_log''s work package (false if the photo_log is gone). For photo_markups membership-scoping.';

-- ----------------------------------------------------------------------------
-- 2. Read-scope the three leaked SELECT policies.
-- ----------------------------------------------------------------------------

-- photo_markups: markups on a photo_log → its WP → its project.
drop policy "photo_markups readable by privileged roles" on public.photo_markups;
create policy "photo_markups readable by privileged roles"
  on public.photo_markups for select
  using ((select public.can_see_photo_log(photo_log_id)));

-- labor_logs: WP-scoped. Only the staff policy is rewritten; the separate
-- "labor_logs readable by bound contractor" self-read policy is left untouched.
drop policy "labor logs readable by field and pm" on public.labor_logs;
create policy "labor logs readable by field and pm"
  on public.labor_logs for select
  using ((select public.can_see_wp(work_package_id)));

-- work_package_dependencies: both endpoints are WPs in the same project; gate
-- on the predecessor's WP.
drop policy "wp_dependencies readable by privileged roles" on public.work_package_dependencies;
create policy "wp_dependencies readable by privileged roles"
  on public.work_package_dependencies for select
  using ((select public.can_see_wp(predecessor_id)));

-- ----------------------------------------------------------------------------
-- 3. Mirror the membership gate onto the app write policies (role list kept).
-- ----------------------------------------------------------------------------

-- photo_logs INSERT.
drop policy "photo_logs insert by sa/pm/super" on public.photo_logs;
create policy "photo_logs insert by sa/pm/super"
  on public.photo_logs for insert
  with check (
    (select public.current_user_role()) in ('site_admin', 'project_manager', 'super_admin')
    and (select public.can_see_wp(work_package_id))
  );

-- approvals INSERT.
drop policy "approvals insert by pm/super" on public.approvals;
create policy "approvals insert by pm/super"
  on public.approvals for insert
  with check (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_wp(work_package_id))
  );

-- purchase_requests INSERT (app path; keeps requester-self + source='app').
drop policy "purchase_requests insert by wp-readers" on public.purchase_requests;
create policy "purchase_requests insert by wp-readers"
  on public.purchase_requests for insert
  with check (
    (select public.current_user_role()) in ('site_admin', 'project_manager', 'super_admin')
    and requested_by = (select auth.uid())
    and source = 'app'
    and (select public.can_see_wp(work_package_id))
  );

-- deliverables INSERT + UPDATE.
drop policy "deliverables insert by pm or super_admin" on public.deliverables;
create policy "deliverables insert by pm or super_admin"
  on public.deliverables for insert
  with check (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_project(project_id))
  );

drop policy "deliverables update by pm or super_admin" on public.deliverables;
create policy "deliverables update by pm or super_admin"
  on public.deliverables for update
  using (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_project(project_id))
  )
  with check (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_project(project_id))
  );

-- reports INSERT.
drop policy "reports insert by pm or super_admin" on public.reports;
create policy "reports insert by pm or super_admin"
  on public.reports for insert
  with check (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_project(project_id))
  );

-- work_packages UPDATE.
drop policy "work_packages update by pm or super_admin" on public.work_packages;
create policy "work_packages update by pm or super_admin"
  on public.work_packages for update
  using (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_project(project_id))
  )
  with check (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    and (select public.can_see_project(project_id))
  );

-- photo_markups INSERT (preserve the content/own-tombstone logic; add the gate).
drop policy "photo_markups insert content or own tombstone" on public.photo_markups;
create policy "photo_markups insert content or own tombstone"
  on public.photo_markups for insert
  with check (
    (select public.current_user_role()) in ('site_admin', 'project_manager', 'super_admin')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.photo_logs pl where pl.id = photo_markups.photo_log_id
    )
    and (
      superseded_by is null
      or exists (
        select 1 from public.photo_markups target
        where target.id = photo_markups.superseded_by
          and target.photo_log_id = photo_markups.photo_log_id
          and target.superseded_by is null
          and target.created_by = (select auth.uid())
      )
    )
    and (select public.can_see_photo_log(photo_log_id))
  );
