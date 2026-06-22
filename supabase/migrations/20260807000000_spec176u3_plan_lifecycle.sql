-- Spec 176 U3 — Supply Plan lifecycle: submit + PD approve/reject (freeze).
--
-- draft → (PM submit) → submitted → (PD approve) → approved [FROZEN]
--                                  → (PD reject)  → rejected → (PM edits + resubmits)
--
-- Separation of duties: the planner tier (PM/super/director) SUBMITS; only the
-- approver tier (project_director/super_admin) APPROVES or REJECTS — a plain PM
-- cannot approve its own plan. A rejected plan becomes editable again (the PM
-- revises and resubmits), so the line add/remove RPCs widen draft → draft|rejected.

-- submit_supply_plan — planner submits a draft/rejected plan for approval.
create function public.submit_supply_plan(p_plan_id uuid)
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
    raise exception 'submit_supply_plan: role not permitted' using errcode = '42501';
  end if;
  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'submit_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project_id) then
    raise exception 'submit_supply_plan: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'submit_supply_plan: only a draft/rejected plan can be submitted' using errcode = '22023';
  end if;

  update public.supply_plans
     set status = 'submitted', submitted_at = now()
   where id = p_plan_id;
end;
$$;

-- approve_supply_plan — the approver (PD/super) freezes a submitted plan.
create function public.approve_supply_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if public.current_user_role() not in ('project_director', 'super_admin') then
    raise exception 'approve_supply_plan: role not permitted' using errcode = '42501';
  end if;
  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'approve_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project_id) then
    raise exception 'approve_supply_plan: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'approve_supply_plan: only a submitted plan can be approved' using errcode = '22023';
  end if;

  update public.supply_plans
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_plan_id;
end;
$$;

-- reject_supply_plan — the approver sends a submitted plan back to the PM.
create function public.reject_supply_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if public.current_user_role() not in ('project_director', 'super_admin') then
    raise exception 'reject_supply_plan: role not permitted' using errcode = '42501';
  end if;
  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'reject_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project_id) then
    raise exception 'reject_supply_plan: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'reject_supply_plan: only a submitted plan can be rejected' using errcode = '22023';
  end if;

  update public.supply_plans set status = 'rejected' where id = p_plan_id;
end;
$$;

revoke all on function public.submit_supply_plan(uuid) from public, anon;
grant execute on function public.submit_supply_plan(uuid) to authenticated;
revoke all on function public.approve_supply_plan(uuid) from public, anon;
grant execute on function public.approve_supply_plan(uuid) to authenticated;
revoke all on function public.reject_supply_plan(uuid) from public, anon;
grant execute on function public.reject_supply_plan(uuid) to authenticated;

comment on function public.submit_supply_plan(uuid) is
  'Spec 176 U3 — planner submits a draft/rejected plan (→ submitted).';
comment on function public.approve_supply_plan(uuid) is
  'Spec 176 U3 — PD/super approves a submitted plan (→ approved, frozen).';
comment on function public.reject_supply_plan(uuid) is
  'Spec 176 U3 — PD/super rejects a submitted plan (→ rejected, editable again).';

-- ----------------------------------------------------------------------------
-- Widen editability: a rejected plan is editable again (PM revises). Same
-- signatures → CREATE OR REPLACE preserves grants (anon stays revoked).
-- ----------------------------------------------------------------------------
create or replace function public.add_supply_plan_line(
  p_plan_id         uuid,
  p_catalog_item_id uuid,
  p_work_package_id uuid,
  p_qty             numeric,
  p_note            text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'add_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_line: unknown plan' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  -- Editable while draft OR rejected; submitted/approved are frozen.
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'add_supply_plan_line: qty must be > 0' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.catalog_items c where c.id = p_catalog_item_id and c.is_active
  ) then
    raise exception 'add_supply_plan_line: unknown or inactive catalog item' using errcode = '22023';
  end if;
  if p_work_package_id is not null and not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = v_project_id
  ) then
    raise exception 'add_supply_plan_line: work package not in this project' using errcode = '22023';
  end if;

  insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
  values (p_plan_id, p_catalog_item_id, p_work_package_id, p_qty, v_note)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.remove_supply_plan_line(p_line_id uuid)
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
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$$;
