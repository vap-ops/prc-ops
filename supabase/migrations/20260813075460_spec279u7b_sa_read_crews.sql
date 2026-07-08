-- ============================================================================
-- Spec 279 U7b / ADR 0079 — SA read-grant on crews for the /sa/crew team view.
--
-- U1 (075410/075420) made crews + crew_members readable ONLY by the onboarding
-- back office (is_back_office) OR a crew's own bound lead. site_admin is NOT in
-- is_back_office, so the /sa/crew page cannot yet render the crew (team)
-- dimension. U7b adds a THIRD, project-scoped SELECT arm: a site_admin may read
-- the crews (and their members) on the projects they can see — the SAME
-- visibility the page already uses to derive its worker roster (work_packages
-- RLS = can_see_project; workers "readable by staff" is role-only and the page
-- app-filters it to that project set). Read-only: no write path is opened to the
-- SA (crew moves are U5, PM-owned), and default_day_rate (money) stays a zero
-- authenticated grant — this arm never widens it.
--
-- current_user_sa_visible_crew_ids(): the crew ids a site_admin may see. SECURITY
-- DEFINER (reads crews without invoker RLS, no recursion) + null/role-safe (only a
-- site_admin widens; every other caller — incl. anon — gets the empty set, never a
-- gate fall-open). Mirrors current_user_led_crew_ids() so the policy stays a
-- hoistable `<col> in (select …)` (rls-eval-once) and the anon grant is revoked
-- (229-anon-exec class).
-- ============================================================================

create function public.current_user_sa_visible_crew_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select c.id
  from public.crews c
  where public.current_user_role() = 'site_admin'
    and public.can_see_project(c.project_id);
$$;
revoke all on function public.current_user_sa_visible_crew_ids() from public, anon;
grant execute on function public.current_user_sa_visible_crew_ids() to authenticated;

-- Add the site_admin project-scoped arm to both SELECT policies (the back-office
-- and own-lead arms are carried through verbatim from 075420, keeping the
-- current_user_role()/current_user_worker_id() calls wrapped for rls-eval-once).
alter policy crews_select on public.crews
using (
  public.is_back_office((select public.current_user_role()))
  or coalesce((select public.current_user_worker_id()) = lead_worker_id, false)
  or id in (select public.current_user_sa_visible_crew_ids())
);

alter policy crew_members_select on public.crew_members
using (
  public.is_back_office((select public.current_user_role()))
  or crew_id in (select public.current_user_led_crew_ids())
  or crew_id in (select public.current_user_sa_visible_crew_ids())
);

comment on function public.current_user_sa_visible_crew_ids() is
  'Spec 279 U7b — the crew ids the current site_admin may SELECT: crews on projects they can see (can_see_project ≡ the /sa/crew work_packages visibility). SECURITY DEFINER + role/null-safe; the site_admin read arm of crews_select/crew_members_select. Read-only — never a write path; money (default_day_rate) stays zero-grant.';
