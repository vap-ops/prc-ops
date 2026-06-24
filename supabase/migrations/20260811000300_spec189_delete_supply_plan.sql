-- Spec 189 follow-up — delete_supply_plan: let a planner delete a supply plan
-- while it is still EDITABLE (draft or rejected). The operator reported plans
-- couldn't be removed even while drafting. submitted/approved are locked — an
-- approved plan may already have generated born-approved PRs (spec 181), and a
-- submitted plan is under review. Planner tier (PM/super/director) + procurement
-- in the PM's stead (spec 181, membership skipped for procurement). Lines cascade
-- (supply_plan_lines.supply_plan_id on delete cascade); a draft/rejected plan has
-- no generated PRs, so no purchase_requests.supply_plan_line_id FK can block it.

create function public.delete_supply_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'delete_supply_plan: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'delete_supply_plan: unknown plan' using errcode = '22023';
  end if;

  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'delete_supply_plan: not a project member' using errcode = '42501';
  end if;

  -- Only an editable plan may be deleted; submitted/approved are frozen.
  if v_status not in ('draft', 'rejected') then
    raise exception 'delete_supply_plan: only a draft/rejected plan can be deleted'
      using errcode = '22023';
  end if;

  delete from public.supply_plans where id = p_plan_id;
end;
$$;

revoke all on function public.delete_supply_plan(uuid) from public, anon;
grant execute on function public.delete_supply_plan(uuid) to authenticated;

comment on function public.delete_supply_plan(uuid) is
  'Spec 189 follow-up — delete a DRAFT/REJECTED supply plan (PM/super/director + member, OR procurement in PM stead). Lines cascade; submitted/approved are locked.';
