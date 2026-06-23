-- Spec 189 U1 — multi-supply-plan: allow a project to have MANY supply plans.
--
-- Spec 176 modeled one plan per project (a single evolving baseline). The
-- operator wants several plans per project (e.g. per phase/period), labeled by
-- creation order + date at read time (no title column). Two changes:
--
--   1. Drop the one-plan-per-project unique constraint.
--   2. create_supply_plan: was get-or-create (idempotent, returned the existing
--      plan). Now it ALWAYS inserts a new draft plan. Creation becomes an
--      explicit action (the planning UI gets a "new plan" button); the add-line
--      RPCs already take an explicit p_plan_id, so they target a chosen plan.
--
-- Unchanged: the planner-tier (PM/super/director) + can_see_project membership
-- gates; the draft-only edit guard on lines; supply_plan_accuracy (it already
-- aggregates ALL of a project's plan lines per WP — plan-agnostic); and
-- generate_purchase_requests_from_plan (per plan_id).

alter table public.supply_plans drop constraint supply_plans_project_unique;

comment on table public.supply_plans is
  'Spec 189 — a project''s material plan (a project may have many). Becomes a frozen PM-accuracy baseline; written only via SECURITY DEFINER RPCs.';

-- Body sourced from the LIVE (spec-181) version — keeps the procurement arm
-- (role list + membership skip); only the get-or-create block is replaced with an
-- unconditional insert.
create or replace function public.create_supply_plan(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'create_supply_plan: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA must be on the project; super/director see all; procurement
  -- is cross-project (PM's stead, spec 181) so it skips the membership gate.
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(p_project_id) then
    raise exception 'create_supply_plan: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_supply_plan: unknown project' using errcode = '22023';
  end if;

  -- Spec 189: always create a NEW draft plan (a project may have many).
  insert into public.supply_plans (project_id) values (p_project_id) returning id into v_id;
  return v_id;
end;
$$;

-- CREATE OR REPLACE keeps the existing grants (same signature); re-assert
-- defensively to keep the EXECUTE posture explicit.
revoke all on function public.create_supply_plan(uuid) from public, anon;
grant execute on function public.create_supply_plan(uuid) to authenticated;

comment on function public.create_supply_plan(uuid) is
  'Spec 189 U1 — create a NEW draft supply plan for a project (PM/super/director + member, OR procurement cross-project in PM stead). A project may have many plans. Returns the new plan id.';
