-- Spec 195 Phase 2 / ADR 0063 — the supply plan generates project-level PRs.
--
-- P1 made a purchase request's work package optional. Now a whole-project supply
-- plan line ("ทั้งโครงการ", work_package_id null) converts into a WP-less PR
-- instead of being rejected (spec 181 raised 22023 for it). The generated PR is
-- scoped to the plan's project (project_id = the plan's project) and stays
-- born-`approved`, inheriting the plan's PD approval, exactly like a WP-bound one.
--
-- CREATE OR REPLACE (same signature) — preserves the EXECUTE grants + needs no
-- db:types regen. Body sourced from LIVE (== migration 20260809001100). Two
-- changes only: drop the null-WP guard, and set project_id on the insert
-- (required now that work_package_id may be null — the P1 BEFORE INSERT trigger
-- only derives project_id when a WP is present; for a WP-less line the plan's
-- project is the authority, and for a WP-bound line the trigger re-derives it).

create or replace function public.generate_purchase_requests_from_plan(p_plan_id uuid, p_line_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_approved_by uuid;
  v_line        record;
  v_count       int := 0;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'generate_purchase_requests_from_plan: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.approved_by
    into v_project_id, v_status, v_approved_by
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'generate_purchase_requests_from_plan: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'generate_purchase_requests_from_plan: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'approved' then
    raise exception 'generate_purchase_requests_from_plan: plan must be approved first' using errcode = '22023';
  end if;
  if p_line_ids is null or array_length(p_line_ids, 1) is null then
    raise exception 'generate_purchase_requests_from_plan: no lines selected' using errcode = '22023';
  end if;

  for v_line in
    select l.id, l.work_package_id, l.qty, c.base_item, c.spec_attrs, c.unit
      from public.supply_plan_lines l
      join public.catalog_items c on c.id = l.catalog_item_id
     where l.supply_plan_id = p_plan_id and l.id = any (p_line_ids)
  loop
    -- Spec 195 P2: a whole-project line (null WP) is allowed — it becomes a
    -- WP-less, project-scoped PR (the null-WP→22023 guard is removed).
    -- Idempotent: a line already converted is skipped (the unique index also guards).
    if exists (
      select 1 from public.purchase_requests pr where pr.supply_plan_line_id = v_line.id
    ) then
      continue;
    end if;

    insert into public.purchase_requests (
      work_package_id, project_id, item_description, quantity, unit,
      status, source, requested_by, approved_by, decided_at,
      supply_plan_line_id
    ) values (
      v_line.work_package_id,   -- null for a whole-project line
      v_project_id,             -- the plan's project (WP-bound lines: re-derived by the trigger)
      v_line.base_item || coalesce(' ' || v_line.spec_attrs, ''),
      v_line.qty,
      v_line.unit,
      'approved',          -- born approved: inherits the plan's PD approval
      'app',
      auth.uid(),          -- the generating user (procurement / PM)
      v_approved_by,       -- the PD who approved the plan
      now(),
      v_line.id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.generate_purchase_requests_from_plan(uuid, uuid[]) is
  'Spec 181 U3 + spec 195 P2 — generate born-approved purchase_requests from an APPROVED plan''s selected lines (PM/super/director/procurement). Idempotent (one PR per line). A whole-project line (no WP) becomes a WP-less PR scoped to the plan''s project (ADR 0063). Returns the count created.';
