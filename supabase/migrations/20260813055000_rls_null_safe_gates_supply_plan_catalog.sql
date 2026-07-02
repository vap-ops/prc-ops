-- rls-audit-2026-07 Pass B / M-B5 supply-plan lifecycle + catalog taxonomy — null-safe SECURITY DEFINER role gates (F1).
-- approve/reject/reopen/submit/create/delete plan, add/remove plan lines, generate PRs from plan, catalog category + subcategory writes (13 fns).
-- Each body is VERBATIM from LIVE (pg_get_functiondef, 2026-07-02) with ONE
-- mechanical edit per gate: a NULL role now fails the gate closed instead of
-- falling through (bare `not in` / `v_role not in` / `<>` / `= any` /
-- `v_is_staff := role in` forms all get an `is null`/`coalesce(...,false)`
-- guard). Real roles behave identically. All CREATE OR REPLACE (no signature
-- change) → grants preserved, no db:types drift, no pin churn.

CREATE OR REPLACE FUNCTION public.approve_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_director', 'super_admin') then
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
$function$;

CREATE OR REPLACE FUNCTION public.reject_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_director', 'super_admin') then
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
$function$;

CREATE OR REPLACE FUNCTION public.reopen_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.supply_plan_status;
begin
  -- super_admin only — this bypasses the separation-of-duties lifecycle.
  if public.current_user_role() is null or public.current_user_role() <> 'super_admin' then
    raise exception 'reopen_supply_plan: super_admin only' using errcode = '42501';
  end if;

  select status into v_status from public.supply_plans where id = p_plan_id;
  if not found then
    raise exception 'reopen_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if v_status not in ('submitted', 'approved') then
    raise exception 'reopen_supply_plan: only a submitted/approved plan can be reopened'
      using errcode = '22023';
  end if;

  update public.supply_plans
     set status = 'draft',
         submitted_at = null,
         approved_by = null,
         approved_at = null,
         overridden_by = auth.uid(),
         overridden_at = now()
   where id = p_plan_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'submit_supply_plan: role not permitted' using errcode = '42501';
  end if;
  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'submit_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(v_project_id))) then
    raise exception 'submit_supply_plan: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'submit_supply_plan: only a draft/rejected plan can be submitted' using errcode = '22023';
  end if;

  update public.supply_plans
     set status = 'submitted', submitted_at = now()
   where id = p_plan_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_supply_plan(p_project_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_supply_plan: role not permitted' using errcode = '42501';
  end if;
  if (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(p_project_id))) then
    raise exception 'create_supply_plan: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_supply_plan: unknown project' using errcode = '22023';
  end if;
  insert into public.supply_plans (project_id) values (p_project_id) returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'delete_supply_plan: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'delete_supply_plan: unknown plan' using errcode = '22023';
  end if;

  if (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(v_project_id))) then
    raise exception 'delete_supply_plan: not a project member' using errcode = '42501';
  end if;

  -- Only an editable plan may be deleted; submitted/approved are frozen.
  if v_status not in ('draft', 'rejected') then
    raise exception 'delete_supply_plan: only a draft/rejected plan can be deleted'
      using errcode = '22023';
  end if;

  delete from public.supply_plans where id = p_plan_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_supply_plan_line(p_plan_id uuid, p_catalog_item_id uuid, p_work_package_id uuid, p_qty numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'add_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_line: unknown plan' using errcode = '22023';
  end if;
  if (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(v_project_id))) then
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
$function$;

CREATE OR REPLACE FUNCTION public.add_supply_plan_lines(p_plan_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_is_template boolean;
  v_line        jsonb;
  v_item        uuid;
  v_wp          uuid;
  v_qty         numeric;
  v_note        text;
  v_count       int := 0;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'add_supply_plan_lines: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.is_template
    into v_project_id, v_status, v_is_template
    from public.supply_plans sp where sp.id = p_plan_id;
  if not found then
    raise exception 'add_supply_plan_lines: unknown plan' using errcode = '22023';
  end if;
  -- Spec 245: a template has no project (no membership to check); every other
  -- plan keeps the existing gate (procurement already skips it, cross-project).
  if not v_is_template
     and (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(v_project_id))) then
    raise exception 'add_supply_plan_lines: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_lines: plan is not editable' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'add_supply_plan_lines: lines must be a json array' using errcode = '22023';
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.remove_supply_plan_line(p_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_is_template boolean;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'remove_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.is_template
    into v_project_id, v_status, v_is_template
    from public.supply_plan_lines l
    join public.supply_plans sp on sp.id = l.supply_plan_id
   where l.id = p_line_id;
  if not found then
    raise exception 'remove_supply_plan_line: unknown line' using errcode = '22023';
  end if;
  if not v_is_template
     and (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(v_project_id))) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_purchase_requests_from_plan(p_plan_id uuid, p_line_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_approved_by uuid;
  v_line        record;
  v_count       int := 0;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'generate_purchase_requests_from_plan: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.approved_by
    into v_project_id, v_status, v_approved_by
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'generate_purchase_requests_from_plan: unknown plan' using errcode = '22023';
  end if;
  if (public.current_user_role() is null
     or (public.current_user_role() <> 'procurement' and not public.can_see_project(v_project_id))) then
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
$function$;

CREATE OR REPLACE FUNCTION public.create_catalog_category(p_code text, p_name text, p_sort_order smallint DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id   uuid;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_category: role not permitted' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'create_catalog_category: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_category: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.catalog_categories (code, name, sort_order)
    values (v_code, v_name, coalesce(p_sort_order, 0))
    returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_catalog_category(p_id uuid, p_code text, p_name text, p_sort_order smallint, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_n    integer;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_catalog_category: role not permitted' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'update_catalog_category: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_catalog_category: name required (<=120)' using errcode = '22023';
  end if;

  update public.catalog_categories
     set code       = v_code,
         name       = v_name,
         sort_order = coalesce(p_sort_order, 0),
         is_active  = coalesce(p_is_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_category: unknown category' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_catalog_subcategory(p_category item_category DEFAULT NULL::item_category, p_code text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_sort_order smallint DEFAULT 0, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id   uuid;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_subcategory: role not permitted' using errcode = '42501';
  end if;
  if v_cat is null then
    raise exception 'create_catalog_subcategory: category required' using errcode = '22023';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'create_catalog_subcategory: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_subcategory: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.catalog_subcategories (category, category_id, code, name, sort_order)
    values (p_category, v_cat, v_code, v_name, coalesce(p_sort_order, 0))
    returning id into v_id;

  return v_id;
end;
$function$;
