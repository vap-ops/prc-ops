-- Spec 181 U2 — bulk-add supply plan lines (the inline grid saves many at once).
--
-- The grid editor lets procurement/PM fill many rows then save them in ONE
-- round-trip. add_supply_plan_lines(plan, jsonb[]) inserts every line atomically
-- (any bad line raises → the whole batch rolls back; no partial saves) with the
-- same per-line validation as the single add_supply_plan_line. Same gate as the
-- single add: PM/super/director/procurement; membership skipped for procurement
-- (cross-project, PM's stead). The plan must be editable (draft/rejected).

create function public.add_supply_plan_lines(p_plan_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
  v_line       jsonb;
  v_item       uuid;
  v_wp         uuid;
  v_qty        numeric;
  v_note       text;
  v_count      int := 0;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'add_supply_plan_lines: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_lines: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_lines: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_lines: plan is not editable' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'add_supply_plan_lines: lines must be a json array' using errcode = '22023';
  end if;

  -- Atomic: validate + insert every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line ->> 'catalog_item_id')::uuid;
    v_wp   := nullif(v_line ->> 'work_package_id', '')::uuid;
    v_qty  := (v_line ->> 'qty')::numeric;
    v_note := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'add_supply_plan_lines: qty must be > 0' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.catalog_items c where c.id = v_item and c.is_active
    ) then
      raise exception 'add_supply_plan_lines: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_wp is not null and not exists (
      select 1 from public.work_packages w
       where w.id = v_wp and w.project_id = v_project_id
    ) then
      raise exception 'add_supply_plan_lines: work package not in this project' using errcode = '22023';
    end if;

    insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
    values (p_plan_id, v_item, v_wp, v_qty, v_note);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.add_supply_plan_lines(uuid, jsonb) from public, anon;
grant execute on function public.add_supply_plan_lines(uuid, jsonb) to authenticated;

comment on function public.add_supply_plan_lines(uuid, jsonb) is
  'Spec 181 U2 — bulk-add plan lines (atomic) to a draft/rejected plan. Gate PM/super/director/procurement (membership skipped for procurement). Returns the count inserted.';
