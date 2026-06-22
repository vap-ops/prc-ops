-- Spec 181 U3 — generate purchase requests from an approved supply plan.
--
-- The "bulk PR" step: an APPROVED plan's selected lines become purchase_requests
-- in one action. Each generated PR is born `approved` — it INHERITS the plan's
-- PD approval (no per-PR re-approval), landing ready for procurement's existing
-- price-compare / PO flow (create_purchase_order operates on approved PRs). The
-- born-approved insert is safe: notify_pr_created fires only `when status =
-- 'requested'`, and every other purchase_requests trigger is AFTER/BEFORE UPDATE.
--
-- Each PR LINKS back to its plan line (supply_plan_line_id). That link is (a) the
-- idempotency key — a line converts at most once (partial unique index) — and
-- (b) how the PM-accuracy measure (spec 176 U5) tells a PLANNED order from a
-- REACTIVE scramble: plan-linked PRs are excluded from the reactive counts
-- (amended below), else generating PRs from the plan would read as planning
-- failures and corrupt the metric the plan exists to produce.

alter table public.purchase_requests
  add column supply_plan_line_id uuid references public.supply_plan_lines(id);

-- A plan line generates at most one PR. NULL (the vast majority of PRs) is
-- unconstrained — a partial unique index, not a table-wide UNIQUE.
create unique index purchase_requests_supply_plan_line_uniq
  on public.purchase_requests (supply_plan_line_id)
  where supply_plan_line_id is not null;

comment on column public.purchase_requests.supply_plan_line_id is
  'Spec 181 — the supply_plan_line this PR was generated from (NULL = a reactive/manual PR). Idempotency key + excludes the PR from the PM-accuracy reactive counts.';

-- ----------------------------------------------------------------------------
-- generate_purchase_requests_from_plan(plan, line_ids[]) — born-approved PRs.
-- Gate: PM/super/director/procurement (membership skipped for procurement, PM's
-- stead). The plan must be APPROVED. Whole-project lines (no WP) can't become a
-- PR (a PR is raised against a WP) → 22023. Already-converted lines are skipped
-- (idempotent). Returns the count created. The insert runs as the definer owner,
-- so the column-scoped authenticated INSERT grant on purchase_requests does not
-- apply (no grant for supply_plan_line_id needed).
-- ----------------------------------------------------------------------------
create function public.generate_purchase_requests_from_plan(p_plan_id uuid, p_line_ids uuid[])
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
    -- A PR is raised against a WP; a whole-project plan line (null WP) can't be one.
    if v_line.work_package_id is null then
      raise exception 'generate_purchase_requests_from_plan: a plan line has no work package (assign one first)'
        using errcode = '22023';
    end if;
    -- Idempotent: a line already converted is skipped (the unique index also guards).
    if exists (
      select 1 from public.purchase_requests pr where pr.supply_plan_line_id = v_line.id
    ) then
      continue;
    end if;

    insert into public.purchase_requests (
      work_package_id, item_description, quantity, unit,
      status, source, requested_by, approved_by, decided_at,
      supply_plan_line_id
    ) values (
      v_line.work_package_id,
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

revoke all on function public.generate_purchase_requests_from_plan(uuid, uuid[]) from public, anon;
grant execute on function public.generate_purchase_requests_from_plan(uuid, uuid[]) to authenticated;

comment on function public.generate_purchase_requests_from_plan(uuid, uuid[]) is
  'Spec 181 U3 — generate born-approved purchase_requests from an APPROVED plan''s selected lines (PM/super/director/procurement). Idempotent (one PR per line); whole-project lines rejected (22023). Returns the count created.';

-- ----------------------------------------------------------------------------
-- Amend supply_plan_accuracy: EXCLUDE plan-generated PRs from the reactive
-- counts (a generated PR is PLANNED, not a reactive scramble). Same signature →
-- CREATE OR REPLACE preserves grants. Only the prs CTE's WHERE changes.
-- ----------------------------------------------------------------------------
create or replace function public.supply_plan_accuracy(p_project_id uuid)
returns table (
  work_package_id uuid,
  wp_code         text,
  wp_name         text,
  planned_lines   int,
  planned_qty     numeric,
  unplanned_miss  int,
  fair_reactive   int,
  untagged        int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'supply_plan_accuracy: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'supply_plan_accuracy: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project_id) then
    raise exception 'supply_plan_accuracy: unknown project' using errcode = '22023';
  end if;

  return query
  with planned as (
    select spl.work_package_id as wp,
           count(*)::int as planned_lines,
           coalesce(sum(spl.qty), 0)::numeric as planned_qty
      from public.supply_plan_lines spl
      join public.supply_plans sp on sp.id = spl.supply_plan_id
     where sp.project_id = p_project_id
     group by spl.work_package_id
  ),
  prs as (
    select w.id as wp,
           count(*) filter (where r.reason_code = 'unplanned_miss')::int as unplanned_miss,
           count(*) filter (
             where r.reason_code in ('rework', 'breakage', 'scope_change', 'unforeseeable')
           )::int as fair_reactive,
           count(*) filter (where r.reason_code is null)::int as untagged
      from public.purchase_requests r
      join public.work_packages w on w.id = r.work_package_id
     where w.project_id = p_project_id
       -- Spec 181 U3: plan-generated PRs are PLANNED, not reactive — exclude them.
       and r.supply_plan_line_id is null
     group by w.id
  ),
  merged as (
    select coalesce(planned.wp, prs.wp) as wp,
           coalesce(planned.planned_lines, 0) as planned_lines,
           coalesce(planned.planned_qty, 0) as planned_qty,
           coalesce(prs.unplanned_miss, 0) as unplanned_miss,
           coalesce(prs.fair_reactive, 0) as fair_reactive,
           coalesce(prs.untagged, 0) as untagged
      from planned
      full outer join prs
        on coalesce(planned.wp, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(prs.wp, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  select m.wp, w.code, w.name,
         m.planned_lines, m.planned_qty,
         m.unplanned_miss, m.fair_reactive, m.untagged
    from merged m
    left join public.work_packages w on w.id = m.wp
   order by m.unplanned_miss desc, w.code asc nulls last;
end;
$$;
