-- Spec 171 U1 — procurement can make purchase requests from the WP screen.
--
-- The operator wants the procurement team to raise a purchase request "instead
-- of the site admins", from the same work-package screen, seeing it like a site
-- admin but only able to edit the request. Requests are created only in WP
-- context (work_package_id is NOT NULL), so procurement needs (a) to READ the
-- WP-context tables the screen renders and (b) to INSERT the request.
--
-- procurement is a CROSS-PROJECT role (spec 102 / ADR 0056): its reach is granted
-- by explicit `current_user_role() = 'procurement'` arms (projects /
-- work_packages / purchase_requests SELECT), NOT by project membership — so
-- can_see_project()/can_see_wp() return FALSE for it. Three WP-context SELECT
-- policies (photo_logs, labor_logs, approvals) are pure can_see_wp(...), so a
-- procurement session sees them empty; and the purchase_requests INSERT policy
-- gates on can_see_wp(...) too, so adding 'procurement' to the role list alone
-- would still be denied. This migration mirrors the spec-102 posture: each of the
-- four policies gains a `current_user_role() = 'procurement'` arm BESIDE its
-- existing can_see_wp arm.
--
-- Posture preserved:
--   * Each policy is DROP+CREATE in place with its NAME unchanged, so the
--     policies_are / qual `like '%can_see_wp%'` pins (pgTAP files 70, 73) stay
--     green; each keeps its can_see_wp arm, so the sa/pm/site_admin membership
--     scoping (ADR 0056) is untouched.
--   * procurement gains SELECT (read-only) on photo_logs/labor_logs/approvals and
--     INSERT on purchase_requests ONLY. No UPDATE (cannot approve/reject/decide —
--     the "purchase_requests update by pm or super" policy is untouched) and no
--     write on photos/labour/approvals (their INSERT policies are untouched).
--   * The labor_logs SELECT rewrite touches ONLY the staff policy
--     ("labor logs readable by field and pm"); the separate
--     "labor_logs readable by bound contractor" self-read policy is left as-is.
--   * Column-scope INSERT grant on purchase_requests is already to `authenticated`
--     (spec 33 / 20260616000400) — procurement, an authenticated user, needs no
--     new privilege, only this policy arm.
--   * appsheet_writer is unaffected: current_user_role() is NULL for that DB role,
--     so no arm admits it; it keeps its own TO appsheet_writer policies.
-- Additive + reversible (drop the procurement arm to revert).

-- 1. photo_logs SELECT — procurement reads the WP's photos (read-only screen).
drop policy "photo_logs readable by privileged roles" on public.photo_logs;
create policy "photo_logs readable by privileged roles"
  on public.photo_logs for select
  using (
    (select public.current_user_role()) = 'procurement'
    or (select public.can_see_wp(work_package_id))
  );

-- 2. labor_logs SELECT (staff policy only) — procurement reads the WP's labour
--    (presence-only; no rate/cost columns, so no pay leak).
drop policy "labor logs readable by field and pm" on public.labor_logs;
create policy "labor logs readable by field and pm"
  on public.labor_logs for select
  using (
    (select public.current_user_role()) = 'procurement'
    or (select public.can_see_wp(work_package_id))
  );

-- 3. approvals SELECT — procurement reads the WP's QA decision history.
drop policy "approvals readable by sa/pm/super" on public.approvals;
create policy "approvals readable by sa/pm/super"
  on public.approvals for select
  using (
    (select public.current_user_role()) = 'procurement'
    or (select public.can_see_wp(work_package_id))
  );

-- 4. purchase_requests INSERT — procurement may raise a request. Keep the
--    requester-self + native-source pins; the role gate becomes
--    ((sa|pm|super) AND can_see_wp) OR procurement. procurement is cross-project,
--    so its arm carries no membership gate (consistent with its SELECT reach).
drop policy "purchase_requests insert by wp-readers" on public.purchase_requests;
create policy "purchase_requests insert by wp-readers"
  on public.purchase_requests for insert
  with check (
    requested_by = (select auth.uid())
    and source = 'app'
    and (
      (
        -- project_director rides along with project_manager (spec 152 / ADR 0058);
        -- pgTAP file 91 pins that every project_manager policy also names it.
        (select public.current_user_role())
          in ('site_admin', 'project_manager', 'super_admin', 'project_director')
        and (select public.can_see_wp(work_package_id))
      )
      or (select public.current_user_role()) = 'procurement'
    )
  );
