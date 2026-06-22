-- Spec 181 U1 — procurement plans supply in the PM's stead.
--
-- The operator's flow: PM plans → procurement compares prices → PD approves →
-- procurement purchases. For the moment procurement ALSO does the planning (PM's
-- stead). So procurement gains the PM-side supply-plan writes (create / add /
-- remove / submit) + cross-project READ — mirroring spec 171/172: procurement is
-- cross-project (can_see_project is false for it), so its arm carries NO
-- membership gate. Approve/reject stay PD/super (procurement never approves its
-- own plan — separation of duties).
--
-- No signature change → `alter policy` (read) + `CREATE OR REPLACE` (RPCs, bodies
-- sourced from LIVE = the spec-176 U1/U3 versions, edited only at the role-list +
-- membership lines). Grants are preserved (anon stays revoked).

-- ----------------------------------------------------------------------------
-- READ: a procurement arm beside can_see_project (cross-project, no membership).
-- ----------------------------------------------------------------------------
alter policy "supply_plans readable by project viewers"
  on public.supply_plans
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );

alter policy "supply_plan_lines readable by project viewers"
  on public.supply_plan_lines
  using (
    (select public.current_user_role()) = 'procurement'
    or exists (
      select 1 from public.supply_plans sp
       where sp.id = supply_plan_id and public.can_see_project(sp.project_id)
    )
  );

-- ----------------------------------------------------------------------------
-- create_supply_plan — role += procurement; membership skipped for procurement.
-- ----------------------------------------------------------------------------
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
  -- is cross-project (PM's stead) so it skips the membership gate.
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(p_project_id) then
    raise exception 'create_supply_plan: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_supply_plan: unknown project' using errcode = '22023';
  end if;

  select sp.id into v_id from public.supply_plans sp where sp.project_id = p_project_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.supply_plans (project_id) values (p_project_id) returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- add_supply_plan_line — role += procurement; membership skipped for procurement.
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
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'add_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_line: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
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

-- ----------------------------------------------------------------------------
-- remove_supply_plan_line — role += procurement; membership skipped for procurement.
-- ----------------------------------------------------------------------------
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
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'remove_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plan_lines l
    join public.supply_plans sp on sp.id = l.supply_plan_id
   where l.id = p_line_id;
  if v_project_id is null then
    raise exception 'remove_supply_plan_line: unknown line' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- submit_supply_plan — role += procurement; membership skipped for procurement.
-- ----------------------------------------------------------------------------
create or replace function public.submit_supply_plan(p_plan_id uuid)
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
    raise exception 'submit_supply_plan: role not permitted' using errcode = '42501';
  end if;
  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'submit_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
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

comment on function public.create_supply_plan(uuid) is
  'Spec 176/181 — get-or-create a project supply plan (PM/super/director + member, OR procurement cross-project in PM stead).';
comment on function public.submit_supply_plan(uuid) is
  'Spec 176/181 — planner OR procurement submits a draft/rejected plan (→ submitted).';
