-- Spec 176 U5 — supply_plan_accuracy(project): the PM-accuracy measure.
--
-- The payoff of the supply-plan arc: surface planned vs reactive so the operator
-- can see how well a PM planned a project. PRs carry a work_package_id + a
-- free-text item (NOT a catalog_item_id), so a PR can't be matched to a specific
-- plan LINE by item — the only shared axis is the work package. So the measure is
-- count-based, per WP: planned line count vs reactive PR counts by reason
-- (unplanned_miss = the misses that count against the PM; fair_reactive =
-- rework/breakage/scope_change/unforeseeable; untagged = legacy null-reason PRs).
--
-- Posture: SECURITY DEFINER read, planner tier (project_manager / super_admin /
-- project_director — project_director rides along per spec 152 / pgTAP file 91) +
-- can_see_project membership. Returns one row per WP (or null = site-general) that
-- has a plan line OR a PR; ALL PR statuses count (a reactive request raised = a
-- planning gap surfaced; a status filter is a flagged refinement).

create function public.supply_plan_accuracy(p_project_id uuid)
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

revoke all on function public.supply_plan_accuracy(uuid) from public, anon;
grant execute on function public.supply_plan_accuracy(uuid) to authenticated;

comment on function public.supply_plan_accuracy(uuid) is
  'Spec 176 U5 — per-WP planned-line count vs reactive PR counts by reason (unplanned_miss = PM misses). Planner tier + project member; the PM-accuracy measure.';
