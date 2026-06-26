-- Spec 208 Phase 2 (U4a) / ADR 0065 — store-only procurement: supply-plan → PR
-- generation lands every PR in the project store.
--
-- Under ADR 0065 a generated PR is always store-bound: work_package_id is forced
-- NULL (the plan line's WP is a planning dimension, not a purchase binding — the
-- material is เบิก'd to a WP after receipt), and catalog_item_id is carried through
-- from the plan line (force-catalog — the line already references a catalog item,
-- so the receive-into-store trigger can snapshot it). Previously the generated PR
-- inherited the line's work_package_id (WP-bound → delivered straight to the WP,
-- never the store) and left catalog_item_id NULL (so even a WP-less generated PR
-- could not be received into the store).
--
-- Additive: CREATE OR REPLACE, same signature → the existing grants
-- (revoke public/anon; grant authenticated, 20260809001100) are preserved;
-- re-asserted below for clarity. Body == 20260813000400 with the two changes.

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
    select l.id, l.work_package_id, l.catalog_item_id, l.qty,
           c.base_item, c.spec_attrs, c.unit
      from public.supply_plan_lines l
      join public.catalog_items c on c.id = l.catalog_item_id
     where l.supply_plan_id = p_plan_id and l.id = any (p_line_ids)
  loop
    -- Idempotent: a line already converted is skipped (the unique index also guards).
    if exists (
      select 1 from public.purchase_requests pr where pr.supply_plan_line_id = v_line.id
    ) then
      continue;
    end if;

    insert into public.purchase_requests (
      work_package_id, project_id, catalog_item_id, item_description, quantity, unit,
      status, source, requested_by, approved_by, decided_at,
      supply_plan_line_id
    ) values (
      -- Spec 208 U4a / ADR 0065: store-only — every generated PR is store-bound.
      -- The plan line's WP is a planning dimension; the PR is WP-less and the
      -- material is เบิก'd to a WP after it is received into the store.
      null,
      v_project_id,             -- the plan's project (store identity)
      v_line.catalog_item_id,   -- force-catalog: snapshotted by the receive trigger
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
