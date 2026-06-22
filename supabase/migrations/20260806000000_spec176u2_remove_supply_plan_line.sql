-- Spec 176 U2 — remove a supply-plan line (for the planning UI).
--
-- Lets a planner delete a mistaken line from a DRAFT plan. Same posture as the
-- U1 write RPCs: SECURITY DEFINER, planner tier (PM/super/director) + member,
-- draft-only (a submitted/approved plan is the frozen baseline). The table has
-- no DELETE grant — this RPC is the only delete path.

create function public.remove_supply_plan_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'remove_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plan_lines l
    join public.supply_plans sp on sp.id = l.supply_plan_id
   where l.id = p_line_id;
  if v_project_id is null then
    raise exception 'remove_supply_plan_line: unknown line' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project_id) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$$;

revoke all on function public.remove_supply_plan_line(uuid) from public, anon;
grant execute on function public.remove_supply_plan_line(uuid) to authenticated;

comment on function public.remove_supply_plan_line(uuid) is
  'Spec 176 U2 — delete a line from a DRAFT supply plan (planner tier + member). Unknown line / frozen plan → 22023.';
