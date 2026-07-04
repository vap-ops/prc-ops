-- Spec 261 / ADR 0070 — procurement_manager parity sweep + manager-only set.
--
-- Migration B (070900 added the enum value). Every function body / policy below
-- is re-sourced VERBATIM from the LIVE database (pg_get_functiondef / pg_policies)
-- and widened DETERMINISTICALLY: 'procurement_manager' is appended alongside every
-- literal 'procurement' role gate (parity), so procurement_manager does everything
-- procurement can. The pgTAP source-scan invariant (275-spec261...) proves no gate
-- was missed. NOT sourced from any older migration file (db-migration-lessons).
--
-- Three exceptions to plain parity:
--   * void_purchase_order        — TIGHTENS (plain procurement removed, manager
--                                   set only). Item 1, walks back spec 259.
--   * void_purchase_order_charge — is_manager() OR procurement_manager. Item 2.
--   * a NEW transition-scoped policy admits procurement_manager to the approved→
--     cancelled PR transition ONLY (item 3); the PM-tier approve path is untouched.
--
-- Existing policies are widened via ALTER POLICY (preserves cmd/roles/permissive
-- verbatim — the lower-risk equivalent of DROP+CREATE for a qual-only widening).

-- ── functions: parity sweep (+ is_back_office widen, void_purchase_order tighten) ──

CREATE OR REPLACE FUNCTION public.add_assembly_component(p_assembly_id uuid, p_component_item_id uuid, p_qty_per numeric, p_waste_factor numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role  text := public.current_user_role()::text;
  v_kind  text;
  v_waste numeric := coalesce(p_waste_factor, 0);
  v_id    uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'add_assembly_component: role not permitted' using errcode = '42501';
  end if;
  if p_assembly_id = p_component_item_id then
    raise exception 'add_assembly_component: an assembly cannot contain itself' using errcode = '22023';
  end if;
  select kind::text into v_kind from public.catalog_items where id = p_assembly_id;
  if not found then
    raise exception 'add_assembly_component: unknown assembly' using errcode = '22023';
  end if;
  if v_kind <> 'assembly' then
    raise exception 'add_assembly_component: parent is not an assembly' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_component_item_id) then
    raise exception 'add_assembly_component: unknown component item' using errcode = '22023';
  end if;
  if p_qty_per is null or p_qty_per <= 0 then
    raise exception 'add_assembly_component: qty_per must be > 0' using errcode = '22023';
  end if;
  if v_waste < 0 then
    raise exception 'add_assembly_component: waste_factor must be >= 0' using errcode = '22023';
  end if;

  insert into public.catalog_assembly_components
      (assembly_id, component_item_id, qty_per, waste_factor, created_by)
    values (p_assembly_id, p_component_item_id, p_qty_per, v_waste, auth.uid())
    returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_boq_line(p_boq_template_id uuid, p_description text, p_qty numeric, p_unit text, p_catalog_item_id uuid DEFAULT NULL::uuid, p_work_category_id uuid DEFAULT NULL::uuid, p_material_rate numeric DEFAULT 0, p_labor_rate numeric DEFAULT 0, p_is_standard boolean DEFAULT true, p_variation_type boq_variation_type DEFAULT 'standard'::boq_variation_type, p_exclusivity_group text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_desc text := btrim(coalesce(p_description, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_excl text := nullif(btrim(coalesce(p_exclusivity_group, '')), '');
  v_mat  numeric := coalesce(p_material_rate, 0);
  v_lab  numeric := coalesce(p_labor_rate, 0);
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'add_boq_line: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.boq_template where id = p_boq_template_id) then
    raise exception 'add_boq_line: unknown template' using errcode = '22023';
  end if;
  if v_desc = '' or length(v_desc) > 500 then
    raise exception 'add_boq_line: description required (<=500)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'add_boq_line: unit required (<=40)' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'add_boq_line: qty must be > 0' using errcode = '22023';
  end if;
  if v_mat < 0 or v_lab < 0 then
    raise exception 'add_boq_line: rates must be >= 0' using errcode = '22023';
  end if;
  if p_catalog_item_id is not null and not exists (
       select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'add_boq_line: unknown catalog item' using errcode = '22023';
  end if;
  if p_work_category_id is not null and not exists (
       select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'add_boq_line: unknown work category' using errcode = '22023';
  end if;

  insert into public.boq_line
      (boq_template_id, catalog_item_id, description, work_category_id, qty, unit,
       material_rate, labor_rate, is_standard, variation_type, exclusivity_group, created_by)
    values
      (p_boq_template_id, p_catalog_item_id, v_desc, p_work_category_id, p_qty, v_unit,
       v_mat, v_lab, coalesce(p_is_standard, true),
       coalesce(p_variation_type, 'standard'), v_excl, auth.uid())
    returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_catalog_item_category(p_item_id uuid, p_category_id uuid, p_subcategory_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'add_catalog_item_category: role not permitted' using errcode = '42501';
  end if;
  if p_item_id is null or p_category_id is null then
    raise exception 'add_catalog_item_category: item and category required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_item_id) then
    raise exception 'add_catalog_item_category: unknown item' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_categories where id = p_category_id) then
    raise exception 'add_catalog_item_category: unknown category' using errcode = '22023';
  end if;
  -- The chosen subcategory must belong to the given category (the composite FK
  -- would also reject it, but we surface a clean 22023 first).
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = p_category_id) then
    raise exception 'add_catalog_item_category: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_item_categories
      (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
    values (p_item_id, p_category_id, p_subcategory_id, false, auth.uid())
    returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_purchase_order_charge(p_po_id uuid, p_charge_type po_charge_type, p_amount numeric, p_vat_rate numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po_number bigint;
  v_charge_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role()
          not in ('project_manager', 'procurement', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'add_purchase_order_charge: role not permitted'
      using errcode = '42501';
  end if;

  select po_number into v_po_number
    from public.purchase_orders where id = p_po_id;
  if v_po_number is null then
    raise exception 'add_purchase_order_charge: purchase order not found'
      using errcode = 'P0001';
  end if;

  -- The table CHECKs enforce amount>0 (23514) and the 'other'-needs-note rule
  -- (a whitespace-only note collapses to NULL here → the CHECK fires 23514).
  insert into public.purchase_order_charges
    (purchase_order_id, charge_type, amount, vat_rate, note, created_by)
  values
    (p_po_id, p_charge_type, p_amount, coalesce(p_vat_rate, 0),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_charge_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'po_charge_add', 'purchase_order_charges', v_charge_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'charge_type', p_charge_type,
       'amount',      p_amount));

  return v_charge_id;
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(v_project_id))) then
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
     or public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement', 'procurement_manager') then
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(v_project_id))) then
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

CREATE OR REPLACE FUNCTION public.add_work_category_material_category(p_work_category_id uuid, p_category_id uuid, p_kind_filter catalog_item_kind DEFAULT NULL::catalog_item_kind)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'add_work_category_material_category: role not permitted' using errcode = '42501';
  end if;
  if p_work_category_id is null or p_category_id is null then
    raise exception 'add_work_category_material_category: work-category and category required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'add_work_category_material_category: unknown work-category' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_categories where id = p_category_id) then
    raise exception 'add_work_category_material_category: unknown category' using errcode = '22023';
  end if;

  insert into public.work_category_material_categories
      (work_category_id, category_id, kind_filter, created_by)
    values (p_work_category_id, p_category_id, p_kind_filter, auth.uid())
    returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_worker_to_project(p_worker uuid, p_project uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_exists boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_role is null
       or v_role not in ('project_manager', 'project_director', 'super_admin', 'procurement', 'procurement_manager') then
    raise exception 'assign_worker_to_project: role not permitted' using errcode = '42501';
  end if;
  select true into v_exists from public.workers where id = p_worker;
  if not found then
    raise exception 'assign_worker_to_project: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set project_id = p_project where id = p_worker;

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (p_worker, p_project, auth.uid(), v_reason);

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers',
          p_worker, jsonb_build_object('kind', 'project_move',
                                       'project_id', p_project,
                                       'reason', v_reason));
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_in_equipment(p_log uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_orig public.equipment_usage_logs%rowtype;
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'procurement_manager', 'super_admin') then
    raise exception 'check_in_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_in_equipment: check-in date required' using errcode = 'P0001';
  end if;

  select * into v_orig from public.equipment_usage_logs where id = p_log;
  if not found then
    raise exception 'check_in_equipment: checkout not found' using errcode = 'P0001';
  end if;
  if v_orig.checked_in_on is not null then
    raise exception 'check_in_equipment: checkout is already closed' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_orig.item_id::text, 0));
  if exists (select 1 from public.equipment_usage_logs n where n.superseded_by = p_log) then
    raise exception 'check_in_equipment: checkout already superseded' using errcode = 'P0001';
  end if;

  if p_date < v_orig.checked_out_on then
    raise exception 'check_in_equipment: check-in before check-out' using errcode = 'P0001';
  end if;

  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, checked_in_on,
     daily_rate_snapshot, entered_by, superseded_by)
  values
    (v_orig.item_id, v_orig.work_package_id, v_orig.checked_out_on, p_date,
     v_orig.daily_rate_snapshot, auth.uid(), p_log)
  returning id into v_id;

  -- F3: clear the in_use overlay — restore the status the item's LATEST movement
  -- implies (deployed→on_site, returned→returned, …; no movement → available),
  -- reusing the equipment_movement_derive_status mapping. Unconditional re-derive:
  -- idempotent and coherent whatever the current status (a movement may have
  -- clobbered in_use mid-checkout). Keeps the registry honest after a return.
  update public.equipment_items ei
     set status = coalesce((
       select (case m.kind
                 when 'received'    then 'available'
                 when 'deployed'    then 'on_site'
                 when 'returned'    then 'returned'
                 when 'maintenance' then 'maintenance'
                 when 'lost'        then 'lost'
               end)::public.equipment_status
         from public.equipment_movements m
        where m.item_id = v_orig.item_id
        order by m.occurred_at desc
        limit 1
     ), 'available'::public.equipment_status)
   where ei.id = v_orig.item_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_out_equipment(p_item uuid, p_wp uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_rate      numeric(12,2);
  v_priced    boolean;
  v_status    public.equipment_status;   -- F2: the item's physical availability
  v_wp_status public.work_package_status;
  v_id        uuid;
begin
  if v_role is null
       or v_role not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'procurement_manager', 'super_admin') then
    raise exception 'check_out_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_out_equipment: checkout date required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 0));

  select daily_rate, daily_rate is not null, status
    into v_rate, v_priced, v_status
    from public.equipment_items where id = p_item;
  if not found then
    raise exception 'check_out_equipment: equipment item not found' using errcode = 'P0001';
  end if;
  if not v_priced then
    raise exception 'check_out_equipment: item has no daily rate (price it first)'
      using errcode = 'P0001';
  end if;
  -- F2: only gear physically on hand can be billed to a WP. maintenance / returned
  -- (to owner) / lost are blocked. 'in_use' passes HERE on purpose — a genuine
  -- in_use has an open span and is caught by the one-open-checkout guard below
  -- with the precise "already checked out" message; a manually-set in_use with no
  -- open span is legitimately checkout-able.
  if v_status not in ('available', 'on_site', 'in_use') then
    raise exception 'check_out_equipment: equipment not on site (maintenance/returned/lost)'
      using errcode = 'P0001';
  end if;

  select status into v_wp_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'check_out_equipment: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'check_out_equipment: work package is complete' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.equipment_usage_logs ul
     where ul.item_id = p_item
       and ul.checked_in_on is null
       and not exists (select 1 from public.equipment_usage_logs n where n.superseded_by = ul.id)
  ) then
    raise exception 'check_out_equipment: item is already checked out' using errcode = 'P0001';
  end if;

  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, daily_rate_snapshot, entered_by)
  values
    (p_item, p_wp, p_date, v_rate, auth.uid())
  returning id into v_id;

  -- F3: best-effort status overlay — the item is now in use. NOT authoritative:
  -- any later equipment_movements row re-derives status via its trigger and
  -- clobbers this; the open usage log remains the source of truth for "is it out".
  update public.equipment_items set status = 'in_use' where id = p_item;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_boq_template(p_code text, p_name text, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'create_boq_template: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 60 then
    raise exception 'create_boq_template: code required (<=60)' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'create_boq_template: name required (<=200)' using errcode = '22023';
  end if;

  insert into public.boq_template (code, name, description, created_by)
    values (v_code, v_name, v_desc, auth.uid())
    returning id into v_id;
  return v_id;
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
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.create_catalog_item(p_category item_category DEFAULT NULL::item_category, p_base_item text DEFAULT NULL::text, p_spec_attrs text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_stockable boolean DEFAULT true, p_note text DEFAULT NULL::text, p_product_code text DEFAULT NULL::text, p_subcategory_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_kind catalog_item_kind DEFAULT 'material'::catalog_item_kind, p_fulfillment_mode catalog_fulfillment_mode DEFAULT NULL::catalog_fulfillment_mode, p_owner_supplied boolean DEFAULT false, p_search_terms text DEFAULT NULL::text, p_lead_time_days integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_id   uuid;
  v_base text := btrim(coalesce(p_base_item, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
  -- Spec 239 U2 — search synonyms (trim→null) + lead time (procurement days).
  v_search text := nullif(btrim(coalesce(p_search_terms, '')), '');
  -- Effective category: explicit category_id wins; else derive from the enum.
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
  -- Spec 224 — fulfillment_mode is the SSOT; bootstrap it from the legacy
  -- p_stockable when no facet is supplied, then derive stockable from it.
  v_mode public.catalog_fulfillment_mode := coalesce(
           p_fulfillment_mode,
           case when coalesce(p_stockable, true) then 'off_shelf'::public.catalog_fulfillment_mode
                else 'made_to_order'::public.catalog_fulfillment_mode end);
  v_stockable boolean := (v_mode = 'off_shelf');
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'create_catalog_item: role not permitted' using errcode = '42501';
  end if;
  if v_cat is null then
    raise exception 'create_catalog_item: category required' using errcode = '22023';
  end if;
  if v_base = '' or length(v_base) > 200 then
    raise exception 'create_catalog_item: base_item required (<=200)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'create_catalog_item: unit required (<=40)' using errcode = '22023';
  end if;
  if v_spec is not null and length(v_spec) > 200 then
    raise exception 'create_catalog_item: spec_attrs too long (<=200)' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'create_catalog_item: note too long (<=1000)' using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[0-9]{6}$' then
    raise exception 'create_catalog_item: product_code must be 6 digits' using errcode = '22023';
  end if;
  -- Spec 239 U2 — guards for the new fields (the DB CHECK on lead_time_days is the floor).
  if v_search is not null and length(v_search) > 500 then
    raise exception 'create_catalog_item: search_terms too long (<=500)' using errcode = '22023';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'create_catalog_item: lead_time_days must be >= 0' using errcode = '22023';
  end if;
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = v_cat) then
    raise exception 'create_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, category_id, base_item, spec_attrs, unit, stockable, note, product_code,
       subcategory_id, kind, fulfillment_mode, owner_supplied, search_terms, lead_time_days)
    values (p_category, v_cat, v_base, v_spec, v_unit, v_stockable, v_note, v_code,
            p_subcategory_id, coalesce(p_kind, 'material'), v_mode, coalesce(p_owner_supplied, false),
            v_search, p_lead_time_days)
    returning id into v_id;

  -- Spec 225 / S4 follow-up: write the canonical is_primary membership mirroring the
  -- new item's canonical (category_id, subcategory_id).
  insert into public.catalog_item_categories
      (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
    values (v_id, v_cat, p_subcategory_id, true, auth.uid());

  return v_id;
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
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.create_catalog_unit(p_code text, p_display_name text, p_abbr_short text DEFAULT NULL::text, p_unit_class unit_class DEFAULT 'count'::unit_class, p_sort_order integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_abbr text := nullif(btrim(coalesce(p_abbr_short, '')), '');
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'create_catalog_unit: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 40 then
    raise exception 'create_catalog_unit: code required (<=40)' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_unit: display_name required (<=120)' using errcode = '22023';
  end if;
  if v_abbr is not null and length(v_abbr) > 40 then
    raise exception 'create_catalog_unit: abbr_short too long (<=40)' using errcode = '22023';
  end if;

  insert into public.catalog_units
      (code, display_name, abbr_short, unit_class, sort_order, created_by)
    values (v_code, v_name, v_abbr, p_unit_class, coalesce(p_sort_order, 0), auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_equipment_project_allocation(p_batch_id uuid, p_project_id uuid, p_starts_on date, p_ends_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'create_equipment_project_allocation: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe FK targets explicitly.
  perform 1 from public.equipment_rental_batches where id = p_batch_id;
  if not found then
    raise exception 'create_equipment_project_allocation: batch not found' using errcode = 'P0001';
  end if;
  perform 1 from public.projects where id = p_project_id;
  if not found then
    raise exception 'create_equipment_project_allocation: project not found' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_project_allocation: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_project_allocation: end before start' using errcode = 'P0001';
  end if;

  insert into public.equipment_project_allocations
    (batch_id, project_id, starts_on, ends_on, note, created_by)
  values (p_batch_id, p_project_id, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_allocation_create', auth.uid(), v_role,
          'equipment_project_allocations', v_id,
          jsonb_build_object('batch_id', p_batch_id, 'project_id', p_project_id,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_equipment_rental_batch(p_owner_id uuid, p_monthly_rate numeric, p_starts_on date, p_ends_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'create_equipment_rental_batch: role not permitted' using errcode = '42501';
  end if;

  perform 1 from public.equipment_owners where id = p_owner_id;
  if not found then
    raise exception 'create_equipment_rental_batch: owner not found' using errcode = 'P0001';
  end if;
  if p_monthly_rate is null or p_monthly_rate < 0 then
    raise exception 'create_equipment_rental_batch: invalid monthly rate' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_rental_batch: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_rental_batch: end before start' using errcode = 'P0001';
  end if;

  insert into public.equipment_rental_batches
    (owner_id, monthly_rate, starts_on, ends_on, note, created_by)
  values (p_owner_id, p_monthly_rate, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_batch_create', auth.uid(), v_role,
          'equipment_rental_batches', v_id,
          jsonb_build_object('owner_id', p_owner_id, 'monthly_rate', p_monthly_rate,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid, p_eta date, p_lines jsonb, p_vat_rate numeric DEFAULT 0, p_order_ref text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supplier_name text;
  v_order_ref     text := nullif(trim(coalesce(p_order_ref, '')), '');
  v_po_id         uuid;
  v_po_number     bigint;
  v_line          jsonb;
  v_request_id    uuid;
  v_amount        numeric;
  v_request_ids   uuid[] := '{}';
  v_delivery_id   uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'create_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'create_purchase_order: no lines'
      using errcode = 'P0001';
  end if;

  if v_order_ref is not null and length(v_order_ref) > 80 then
    raise exception 'create_purchase_order: order_ref longer than 80 characters'
      using errcode = 'P0001';
  end if;

  select s.name into v_supplier_name
    from public.suppliers s
   where s.id = p_supplier_id;
  if v_supplier_name is null then
    raise exception 'create_purchase_order: supplier not found'
      using errcode = 'P0001';
  end if;

  insert into public.purchase_orders
    (supplier_id, supplier, eta, ordered_at, created_by)
  values
    (p_supplier_id, v_supplier_name, p_eta, now(), auth.uid())
  returning id, po_number into v_po_id, v_po_number;

  -- Spec 135 U1: the default delivery = the whole PO (auto). Member lines join it.
  insert into public.purchase_order_deliveries (purchase_order_id, eta, created_by)
  values (v_po_id, p_eta, auth.uid())
  returning id into v_delivery_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_request_id := (v_line->>'request_id')::uuid;
    v_amount     := nullif(v_line->>'amount', '')::numeric;

    if v_amount is not null and v_amount <= 0 then
      raise exception 'create_purchase_order: amount must be positive'
        using errcode = 'P0001';
    end if;

    update public.purchase_requests
       set supplier          = v_supplier_name,
           supplier_id       = p_supplier_id,
           amount            = v_amount,
           vat_rate          = p_vat_rate,
           order_ref         = v_order_ref,
           eta               = p_eta,
           purchased_at      = now(),
           status            = 'purchased',
           purchase_order_id = v_po_id,
           delivery_id       = v_delivery_id
     where id = v_request_id
       and status = 'approved'
       and purchased_at is null;
    if not found then
      raise exception 'create_purchase_order: line % is not an approved request', v_request_id
        using errcode = 'P0001';
    end if;

    v_request_ids := v_request_ids || v_request_id;
  end loop;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'purchase_order_create', 'purchase_orders', v_po_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'supplier',    v_supplier_name,
       'supplier_id', p_supplier_id,
       'eta',         p_eta,
       'vat_rate',    p_vat_rate,
       'order_ref',   v_order_ref,
       'delivery_id', v_delivery_id,
       'line_count',  jsonb_array_length(p_lines),
       'request_ids', to_jsonb(v_request_ids)
     ));

  return v_po_id;
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(p_project_id))) then
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(v_project_id))) then
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

CREATE OR REPLACE FUNCTION public.dispatch_purchase_order_delivery(p_delivery_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'dispatch_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.purchase_order_deliveries where id = p_delivery_id
  ) then
    raise exception 'dispatch_purchase_order_delivery: delivery not found'
      using errcode = 'P0001';
  end if;

  -- Mark the งวด's not-yet-shipped lines as shipped; the derive trigger flips
  -- purchased → on_route and the audit/notification triggers fire (no explicit writes
  -- here, the record_shipment posture). Already-shipped / delivered lines are left
  -- as-is, so a re-dispatch is a harmless 0-row no-op.
  update public.purchase_requests
     set shipped_at = now()
   where delivery_id = p_delivery_id
     and status = 'purchased'
     and shipped_at is null;
  get diagnostics v_count = row_count;

  return v_count;
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(v_project_id))) then
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

CREATE OR REPLACE FUNCTION public.is_back_office(p_role user_role)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_role in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director'), false)
$function$;

CREATE OR REPLACE FUNCTION public.receive_po_lines(p_request_ids uuid[], p_received_by text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id    uuid;
  v_count integer := 0;
  v_batch uuid := gen_random_uuid();
begin
  -- Receiving is a site action (site_admin / project_manager / super_admin /
  -- project_director) PLUS procurement (spec 208 Q3 — the off-site team helps
  -- receive when site staff are short).
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement', 'procurement_manager') then
    raise exception 'receive_po_lines: role not permitted' using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'receive_po_lines: no lines' using errcode = 'P0001';
  end if;

  foreach v_id in array p_request_ids loop
    update public.purchase_requests
       set delivered_at      = now(),
           received_by       = p_received_by,
           delivery_note     = p_delivery_note,
           delivery_batch_id = v_batch
     where id = v_id
       and status in ('purchased', 'on_route');
    if not found then
      raise exception 'receive_po_lines: line % is not an in-transit member', v_id
        using errcode = 'P0001';
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_purchase(p_purchase_request_id uuid, p_supplier_id uuid, p_order_ref text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_eta date DEFAULT NULL::date, p_vat_rate numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supplier_name text;
  v_order_ref text := nullif(trim(coalesce(p_order_ref, '')), '');
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'record_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_purchase: amount must be positive'
      using errcode = 'P0001';
  end if;

  if v_order_ref is not null and length(v_order_ref) > 80 then
    raise exception 'record_purchase: order_ref longer than 80 characters'
      using errcode = 'P0001';
  end if;

  select s.name into v_supplier_name
    from public.suppliers s
   where s.id = p_supplier_id;
  if v_supplier_name is null then
    raise exception 'record_purchase: supplier not found'
      using errcode = 'P0001';
  end if;

  update public.purchase_requests
     set supplier     = v_supplier_name,
         supplier_id  = p_supplier_id,
         order_ref    = coalesce(v_order_ref, order_ref),
         amount       = coalesce(p_amount, amount),
         eta          = coalesce(p_eta, eta),
         vat_rate     = p_vat_rate,
         purchased_at = now()
   where id = p_purchase_request_id
     and status = 'approved'
     and purchased_at is null;
  if not found then
    raise exception 'record_purchase: request is not in a recordable state'
      using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_shipment(p_purchase_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'record_shipment: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set shipped_at = now()
   where id = p_purchase_request_id
     and status = 'purchased'
     and shipped_at is null;
  if not found then
    raise exception 'record_shipment: request is not in a shippable state'
      using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_in_bulk(p_project_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role     public.user_role := public.current_user_role();
  v_line     jsonb;
  v_item     uuid;
  v_qty      numeric;
  v_cost     numeric;
  v_supplier uuid;
  v_note     text;
  v_unit     text;
  v_count    int := 0;
begin
  -- Role: site_admin (storekeeper) + the cost-bearing curation tier — identical
  -- to the post-spec-197 record_stock_in gate.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'record_stock_in_bulk: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA by membership / super/director see-all; procurement is a
  -- cross-project curator.
  if not (public.can_see_project(p_project_id) or v_role in ('procurement', 'procurement_manager')) then
    raise exception 'record_stock_in_bulk: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'record_stock_in_bulk: unknown project' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'record_stock_in_bulk: lines must be a non-empty json array' using errcode = '22023';
  end if;

  -- Atomic: validate + insert every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item     := (v_line ->> 'catalog_item_id')::uuid;
    v_qty      := (v_line ->> 'qty')::numeric;
    v_cost     := (v_line ->> 'unit_cost')::numeric;
    v_supplier := nullif(v_line ->> 'supplier_id', '')::uuid;
    v_note     := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'record_stock_in_bulk: qty must be > 0' using errcode = '22023';
    end if;
    if v_cost is null or v_cost < 0 then
      raise exception 'record_stock_in_bulk: unit_cost must be >= 0' using errcode = '22023';
    end if;
    -- Catalog item must exist and be active; snapshot its unit onto the receipt.
    select c.unit into v_unit
      from public.catalog_items c
     where c.id = v_item and c.is_active;
    if v_unit is null then
      raise exception 'record_stock_in_bulk: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_supplier is not null and not exists (
      select 1 from public.suppliers s where s.id = v_supplier
    ) then
      raise exception 'record_stock_in_bulk: unknown supplier' using errcode = '22023';
    end if;

    insert into public.stock_receipts
      (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
    values
      (p_project_id, v_item, v_qty, v_unit, v_cost, v_supplier, v_note);

    -- Roll into on-hand: a pure stock-IN is additive (qty + value).
    insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
    values (p_project_id, v_item, v_qty, v_qty * v_cost)
    on conflict (project_id, catalog_item_id) do update
      set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
          total_value = public.stock_on_hand.total_value + excluded.total_value,
          updated_at  = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_in(p_project_id uuid, p_catalog_item_id uuid, p_qty numeric, p_unit_cost numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_unit text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  -- Role: the cost-bearing curation tier PLUS site_admin (the on-site
  -- storekeeper who receives deliveries — spec 197 U1).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'record_stock_in: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA by membership / super/director see-all (can_see_project);
  -- procurement is a cross-project curator.
  if not (public.can_see_project(p_project_id) or v_role in ('procurement', 'procurement_manager')) then
    raise exception 'record_stock_in: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'record_stock_in: unknown project' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'record_stock_in: qty must be > 0' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'record_stock_in: unit_cost must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit onto the receipt.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'record_stock_in: unknown or inactive catalog item' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id
  ) then
    raise exception 'record_stock_in: unknown supplier' using errcode = '22023';
  end if;

  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, p_unit_cost, p_supplier_id, v_note)
  returning id into v_id;

  -- Roll into on-hand: a pure stock-IN is additive (qty + value); the moving-avg
  -- recompute only matters on issue-OUT (a later phase).
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * p_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_assembly_component(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'remove_assembly_component: role not permitted' using errcode = '42501';
  end if;

  delete from public.catalog_assembly_components where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_assembly_component: unknown component' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_boq_line(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'remove_boq_line: role not permitted' using errcode = '42501';
  end if;

  delete from public.boq_line where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_boq_line: unknown line' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_catalog_item_category(p_item_id uuid, p_category_id uuid, p_subcategory_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role       text := public.current_user_role()::text;
  v_is_primary boolean;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'remove_catalog_item_category: role not permitted' using errcode = '42501';
  end if;

  -- Locate the membership (coalesce the nullable subcategory to the same sentinel
  -- the uniqueness index uses, so a category-grain row matches a NULL arg).
  select is_primary into v_is_primary
    from public.catalog_item_categories
   where catalog_item_id = p_item_id
     and category_id = p_category_id
     and coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_is_primary is null then
    raise exception 'remove_catalog_item_category: unknown membership' using errcode = '22023';
  end if;
  if v_is_primary then
    raise exception 'remove_catalog_item_category: cannot unlink the primary (canonical) membership' using errcode = '22023';
  end if;

  delete from public.catalog_item_categories
   where catalog_item_id = p_item_id
     and category_id = p_category_id
     and coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid);
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
     or public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement', 'procurement_manager') then
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(v_project_id))) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_work_category_material_category(p_work_category_id uuid, p_category_id uuid, p_kind_filter catalog_item_kind DEFAULT NULL::catalog_item_kind)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'remove_work_category_material_category: role not permitted' using errcode = '42501';
  end if;

  -- Match the same coalesce-text NULL handling the uniqueness index uses, so a
  -- NULL-kind arg targets exactly the NULL-kind row (not a typed-kind sibling).
  delete from public.work_category_material_categories
   where work_category_id = p_work_category_id
     and category_id = p_category_id
     and coalesce((kind_filter)::text, '') = coalesce((p_kind_filter)::text, '');

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_work_category_material_category: unknown relation' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_stock_receipt(p_receipt_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'reverse_stock_receipt: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_receipts where id = p_receipt_id;
  if v_project is null then
    raise exception 'reverse_stock_receipt: unknown receipt' using errcode = '22023';
  end if;
  if not (public.can_see_project(v_project) or v_role in ('procurement', 'procurement_manager')) then
    raise exception 'reverse_stock_receipt: not a project member' using errcode = '42501';
  end if;

  insert into public.stock_reversals (project_id, catalog_item_id, receipt_id, qty, value_delta, note)
  values (v_project, v_item, p_receipt_id, v_qty, -v_total_cost, v_note)
  returning id into v_id;

  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null or v_on_hand < v_qty then
    raise exception 'reverse_stock_receipt: stock already moved, cannot reverse'
      using errcode = '22023';
  end if;

  update public.stock_on_hand
     set qty_on_hand = v_on_hand - v_qty,
         total_value = case when v_on_hand - v_qty = 0 then 0 else v_value - v_total_cost end,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_boq_template_active(p_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'set_boq_template_active: role not permitted' using errcode = '42501';
  end if;

  update public.boq_template
     set is_active = coalesce(p_is_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_boq_template_active: unknown template' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_catalog_unit_active(p_code text, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'set_catalog_unit_active: role not permitted' using errcode = '42501';
  end if;

  update public.catalog_units
     set is_active = coalesce(p_is_active, true)
   where code = v_code;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_catalog_unit_active: unknown code' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_equipment_daily_rate(p_id uuid, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_old  numeric;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'set_equipment_daily_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_equipment_daily_rate: invalid rate' using errcode = 'P0001';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly.
  select daily_rate into v_old from public.equipment_items where id = p_id;
  if not found then
    raise exception 'set_equipment_daily_rate: equipment item not found' using errcode = 'P0001';
  end if;

  update public.equipment_items set daily_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_rate_change', auth.uid(), v_role,
          'equipment_items', p_id,
          jsonb_build_object('kind', 'rate_change',
                             'old_rate', v_old, 'new_rate', p_rate));
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_contractor(p_work_package_id uuid, p_contractor_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement', 'procurement_manager') then
    raise exception 'set_work_package_contractor: role not permitted'
      using errcode = '42501';
  end if;

  if p_contractor_id is not null
     and not exists (select 1 from public.contractors c where c.id = p_contractor_id) then
    return false;
  end if;

  update public.work_packages
     set contractor_id = p_contractor_id
   where id = p_work_package_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.split_purchase_order_delivery(p_purchase_order_id uuid, p_request_ids uuid[], p_eta date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_cost numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_delivery_id uuid;
  v_count       int;
  v_source      record;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'split_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'split_purchase_order_delivery: no lines selected'
      using errcode = 'P0001';
  end if;

  if p_cost is not null and p_cost < 0 then
    raise exception 'split_purchase_order_delivery: cost must be >= 0'
      using errcode = 'P0001';
  end if;

  -- Lock the selected rows first (a separate statement — FOR UPDATE is not allowed
  -- with an aggregate), so a concurrent split can't move the same line twice.
  perform 1
    from public.purchase_requests
   where id = any(p_request_ids)
   for update;

  -- Every selected id must be a distinct in-transit member of THIS PO. A count
  -- mismatch catches a non-member, an already-received (delivered) line, a
  -- rejected/cancelled line, and a duplicate id in one check.
  select count(*) into v_count
    from public.purchase_requests
   where id = any(p_request_ids)
     and purchase_order_id = p_purchase_order_id
     and status in ('purchased', 'on_route');

  if v_count <> array_length(p_request_ids, 1) then
    raise exception
      'split_purchase_order_delivery: every line must be an in-transit member of the PO'
      using errcode = 'P0001';
  end if;

  -- Non-empty guard: each source delivery the selection draws from must keep >= 1
  -- active (non rejected/cancelled) line after the move. A delivered line counts —
  -- it keeps the delivery alive even when all its in-transit lines move out.
  for v_source in
    select distinct delivery_id
      from public.purchase_requests
     where id = any(p_request_ids)
  loop
    if (select count(*)
          from public.purchase_requests r
         where r.delivery_id = v_source.delivery_id
           and r.status not in ('rejected', 'cancelled')
           and not (r.id = any(p_request_ids))) = 0 then
      raise exception
        'split_purchase_order_delivery: a source delivery cannot be emptied by the split'
        using errcode = 'P0001';
    end if;
  end loop;

  insert into public.purchase_order_deliveries
    (purchase_order_id, eta, note, cost, created_by)
  values
    (p_purchase_order_id, p_eta, nullif(trim(coalesce(p_note, '')), ''), p_cost, auth.uid())
  returning id into v_delivery_id;

  update public.purchase_requests
     set delivery_id = v_delivery_id
   where id = any(p_request_ids);

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'update', 'purchase_order_deliveries', v_delivery_id,
     jsonb_build_object(
       'principal',         session_user,
       'transition',        jsonb_build_array('delivery_split'),
       'purchase_order_id', p_purchase_order_id,
       'delivery_id',       v_delivery_id,
       'request_ids',       to_jsonb(p_request_ids),
       'line_count',        array_length(p_request_ids, 1),
       'eta',               p_eta,
       'cost',              p_cost
     ));

  return v_delivery_id;
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
     or (public.current_user_role() not in ('procurement', 'procurement_manager') and not public.can_see_project(v_project_id))) then
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

CREATE OR REPLACE FUNCTION public.update_assembly_component(p_id uuid, p_qty_per numeric, p_waste_factor numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role  text := public.current_user_role()::text;
  v_waste numeric := coalesce(p_waste_factor, 0);
  v_n     integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'update_assembly_component: role not permitted' using errcode = '42501';
  end if;
  if p_qty_per is null or p_qty_per <= 0 then
    raise exception 'update_assembly_component: qty_per must be > 0' using errcode = '22023';
  end if;
  if v_waste < 0 then
    raise exception 'update_assembly_component: waste_factor must be >= 0' using errcode = '22023';
  end if;

  update public.catalog_assembly_components
     set qty_per = p_qty_per, waste_factor = v_waste
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_assembly_component: unknown component' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_boq_line(p_id uuid, p_description text, p_qty numeric, p_unit text, p_catalog_item_id uuid DEFAULT NULL::uuid, p_work_category_id uuid DEFAULT NULL::uuid, p_material_rate numeric DEFAULT 0, p_labor_rate numeric DEFAULT 0, p_is_standard boolean DEFAULT true, p_variation_type boq_variation_type DEFAULT 'standard'::boq_variation_type, p_exclusivity_group text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_desc text := btrim(coalesce(p_description, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_excl text := nullif(btrim(coalesce(p_exclusivity_group, '')), '');
  v_mat  numeric := coalesce(p_material_rate, 0);
  v_lab  numeric := coalesce(p_labor_rate, 0);
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'update_boq_line: role not permitted' using errcode = '42501';
  end if;
  if v_desc = '' or length(v_desc) > 500 then
    raise exception 'update_boq_line: description required (<=500)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'update_boq_line: unit required (<=40)' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'update_boq_line: qty must be > 0' using errcode = '22023';
  end if;
  if v_mat < 0 or v_lab < 0 then
    raise exception 'update_boq_line: rates must be >= 0' using errcode = '22023';
  end if;
  if p_catalog_item_id is not null and not exists (
       select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'update_boq_line: unknown catalog item' using errcode = '22023';
  end if;
  if p_work_category_id is not null and not exists (
       select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'update_boq_line: unknown work category' using errcode = '22023';
  end if;

  -- line_status is NOT edited here (the draft→frozen transition is S10-U5).
  update public.boq_line
     set catalog_item_id   = p_catalog_item_id,
         description       = v_desc,
         work_category_id  = p_work_category_id,
         qty               = p_qty,
         unit              = v_unit,
         material_rate     = v_mat,
         labor_rate        = v_lab,
         is_standard       = coalesce(p_is_standard, true),
         variation_type    = coalesce(p_variation_type, 'standard'),
         exclusivity_group = v_excl
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_boq_line: unknown line' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_boq_template(p_id uuid, p_name text, p_description text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'update_boq_template: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'update_boq_template: name required (<=200)' using errcode = '22023';
  end if;

  update public.boq_template
     set name = v_name, description = v_desc
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_boq_template: unknown template' using errcode = '22023';
  end if;
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
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.update_catalog_item(p_id uuid, p_category item_category DEFAULT NULL::item_category, p_base_item text DEFAULT NULL::text, p_spec_attrs text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_stockable boolean DEFAULT true, p_note text DEFAULT NULL::text, p_product_code text DEFAULT NULL::text, p_subcategory_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_kind catalog_item_kind DEFAULT 'material'::catalog_item_kind, p_fulfillment_mode catalog_fulfillment_mode DEFAULT NULL::catalog_fulfillment_mode, p_owner_supplied boolean DEFAULT false, p_search_terms text DEFAULT NULL::text, p_lead_time_days integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_base text := btrim(coalesce(p_base_item, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
  v_search text := nullif(btrim(coalesce(p_search_terms, '')), '');
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
  v_mode public.catalog_fulfillment_mode := coalesce(
           p_fulfillment_mode,
           case when coalesce(p_stockable, true) then 'off_shelf'::public.catalog_fulfillment_mode
                else 'made_to_order'::public.catalog_fulfillment_mode end);
  v_stockable boolean := (v_mode = 'off_shelf');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'update_catalog_item: role not permitted' using errcode = '42501';
  end if;
  if v_cat is null then
    raise exception 'update_catalog_item: category required' using errcode = '22023';
  end if;
  if v_base = '' or length(v_base) > 200 then
    raise exception 'update_catalog_item: base_item required (<=200)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'update_catalog_item: unit required (<=40)' using errcode = '22023';
  end if;
  if v_spec is not null and length(v_spec) > 200 then
    raise exception 'update_catalog_item: spec_attrs too long (<=200)' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'update_catalog_item: note too long (<=1000)' using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[0-9]{6}$' then
    raise exception 'update_catalog_item: product_code must be 6 digits' using errcode = '22023';
  end if;
  if v_search is not null and length(v_search) > 500 then
    raise exception 'update_catalog_item: search_terms too long (<=500)' using errcode = '22023';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'update_catalog_item: lead_time_days must be >= 0' using errcode = '22023';
  end if;
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = v_cat) then
    raise exception 'update_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  update public.catalog_items
     set category         = p_category,
         category_id      = v_cat,
         base_item        = v_base,
         spec_attrs       = v_spec,
         unit             = v_unit,
         stockable        = v_stockable,
         note             = v_note,
         product_code     = v_code,
         subcategory_id   = p_subcategory_id,
         kind             = coalesce(p_kind, 'material'),
         fulfillment_mode = v_mode,
         owner_supplied   = coalesce(p_owner_supplied, false),
         search_terms     = v_search,
         lead_time_days   = p_lead_time_days
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;

  -- Spec 225 / S4 follow-up: keep the canonical is_primary membership in lockstep with
  -- the (possibly changed) canonical home. First drop a SECONDARY membership that would
  -- collide with the new canonical pair, then move the single primary row; insert one if
  -- the item somehow has none.
  delete from public.catalog_item_categories
   where catalog_item_id = p_id
     and not is_primary
     and category_id = v_cat
     and coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid);

  update public.catalog_item_categories
     set category_id = v_cat, subcategory_id = p_subcategory_id
   where catalog_item_id = p_id and is_primary;

  if not found then
    insert into public.catalog_item_categories
        (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
      values (p_id, v_cat, p_subcategory_id, true, auth.uid());
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_catalog_unit(p_code text, p_display_name text, p_abbr_short text DEFAULT NULL::text, p_unit_class unit_class DEFAULT 'count'::unit_class, p_sort_order integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_abbr text := nullif(btrim(coalesce(p_abbr_short, '')), '');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'update_catalog_unit: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_catalog_unit: display_name required (<=120)' using errcode = '22023';
  end if;
  if v_abbr is not null and length(v_abbr) > 40 then
    raise exception 'update_catalog_unit: abbr_short too long (<=40)' using errcode = '22023';
  end if;

  -- code is the stored value on consuming rows — NOT editable here (recoding would
  -- orphan stored references). The row is identified by code; the editable fields
  -- are display_name / abbr_short / unit_class / sort_order.
  update public.catalog_units
     set display_name = v_name,
         abbr_short   = v_abbr,
         unit_class   = p_unit_class,
         sort_order   = coalesce(p_sort_order, 0)
   where code = v_code;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_unit: unknown code' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_purchase_order(p_po_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po_number    bigint;
  v_supplier     text;
  v_request_ids  uuid[];
  v_bad_count    integer;
  v_member       record;
  v_old_entry    uuid;
begin
  -- Back-office gate, identical to create_purchase_order (ADR 0044 §4) — the
  -- same audience that can create a PO can undo their own mistake.
  if public.current_user_role() is null
     or public.current_user_role()
          not in ('project_manager', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'void_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  select po_number, supplier into v_po_number, v_supplier
    from public.purchase_orders
   where id = p_po_id;
  if v_po_number is null then
    raise exception 'void_purchase_order: purchase order not found'
      using errcode = 'P0001';
  end if;

  -- Revertible only while NOTHING has shipped: every member must still be
  -- exactly at 'purchased' (record_shipment / receive not yet run on any of
  -- them). All-or-nothing — a partially-shipped order needs the per-ticket
  -- paths, not a whole-order undo.
  select count(*) into v_bad_count
    from public.purchase_requests
   where purchase_order_id = p_po_id
     and status <> 'purchased';
  if v_bad_count > 0 then
    raise exception 'void_purchase_order: order has a shipped or received line'
      using errcode = 'P0001';
  end if;

  select array_agg(id) into v_request_ids
    from public.purchase_requests
   where purchase_order_id = p_po_id;

  -- Per member: undo the GL side-effect of its purchase BEFORE unlinking it
  -- (spec 198 U2 pattern) — reverse a posted entry, or skip a pending job.
  for v_member in
    select id from public.purchase_requests where purchase_order_id = p_po_id
  loop
    select e.id into v_old_entry
      from public.journal_entries e
     where e.source_table = 'purchase_requests'
       and e.source_id    = v_member.id
       and e.source_event = 'purchase'
       and e.status       = 'posted'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
     limit 1;
    if v_old_entry is not null then
      perform public.reverse_journal_internal(
        v_old_entry, auth.uid(), 'void: purchase order reverted');
    end if;

    update public.gl_posting_outbox
       set status = 'skipped'
     where source_table = 'purchase_requests'
       and source_id    = v_member.id
       and source_event = 'purchase'
       and status in ('pending', 'posting');
  end loop;

  -- Spec 260: the PO's charges cascade on the FK, but their GL entries / outbox
  -- jobs do not — reverse a posted charge entry or skip a pending job first
  -- (identical shape to the member loop), so a voided PO leaves no phantom
  -- charge posting behind.
  for v_member in
    select id from public.purchase_order_charges where purchase_order_id = p_po_id
  loop
    select e.id into v_old_entry
      from public.journal_entries e
     where e.source_table = 'purchase_order_charges'
       and e.source_id    = v_member.id
       and e.source_event = 'po_charge'
       and e.status       = 'posted'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
     limit 1;
    if v_old_entry is not null then
      perform public.reverse_journal_internal(
        v_old_entry, auth.uid(), 'void: purchase order reverted (charge)');
    end if;

    update public.gl_posting_outbox
       set status = 'skipped'
     where source_table = 'purchase_order_charges'
       and source_id    = v_member.id
       and source_event = 'po_charge'
       and status in ('pending', 'posting');
  end loop;

  -- Undo exactly what create_purchase_order stamped — members return to
  -- their pre-purchase shape and are free to be bundled into the correct PO.
  -- vat_rate is NOT NULL (default 0 = "no VAT recorded", spec 119) so it
  -- resets to 0, not null, to match every never-purchased row. needed_by
  -- (the requester's own field) is never touched.
  update public.purchase_requests
     set status            = 'approved',
         purchase_order_id = null,
         delivery_id       = null,
         supplier          = null,
         supplier_id       = null,
         amount            = null,
         vat_rate          = 0,
         order_ref         = null,
         eta               = null,
         purchased_at      = null
   where purchase_order_id = p_po_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'purchase_order_void', 'purchase_orders', p_po_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'supplier',    v_supplier,
       'request_ids', to_jsonb(v_request_ids)
     ));

  -- purchase_order_deliveries + purchase_order_charges cascade on their FKs;
  -- the PO's po_number is retired, never reused (the running-sequence rule).
  delete from public.purchase_orders where id = p_po_id;
end;
$function$;

-- ── void_purchase_order_charge — item 2 (is_manager OR procurement_manager) ──

CREATE OR REPLACE FUNCTION public.void_purchase_order_charge(p_charge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_charge    public.purchase_order_charges%rowtype;
  v_po_number bigint;
  v_old_entry uuid;
begin
  -- Spec 261 / ADR 0070 item 2: manager tier (is_manager keeps project_director,
  -- ADR 0058) PLUS the procurement dept manager.
  if not (public.is_manager(public.current_user_role())
          or public.current_user_role() = 'procurement_manager') then
    raise exception 'void_purchase_order_charge: role not permitted'
      using errcode = '42501';
  end if;

  select * into v_charge
    from public.purchase_order_charges where id = p_charge_id;
  if not found then
    raise exception 'void_purchase_order_charge: charge not found'
      using errcode = 'P0001';
  end if;

  select po_number into v_po_number
    from public.purchase_orders where id = v_charge.purchase_order_id;

  -- reverse_journal_internal takes an ENTRY id — look the posted, not-yet-
  -- reversed entry up by (source_table, source_id, source_event) first.
  select e.id into v_old_entry
    from public.journal_entries e
   where e.source_table = 'purchase_order_charges'
     and e.source_id    = p_charge_id
     and e.source_event = 'po_charge'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old_entry is not null then
    perform public.reverse_journal_internal(
      v_old_entry, auth.uid(), 'void: PO charge removed');
  end if;

  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'purchase_order_charges'
     and source_id    = p_charge_id
     and source_event = 'po_charge'
     and status in ('pending', 'posting');

  -- Audit BEFORE the delete (the payload captures the row about to vanish).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'po_charge_void', 'purchase_order_charges', p_charge_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'charge_type', v_charge.charge_type,
       'amount',      v_charge.amount));

  delete from public.purchase_order_charges where id = p_charge_id;
end;
$function$;

-- ── policies: parity widen via ALTER POLICY ──

alter policy "approvals readable by sa/pm/super" on public.approvals
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_wp(approvals.work_package_id) AS can_see_wp)));

alter policy "audit_log select wp rework events" on public.audit_log
  using (((COALESCE((( SELECT current_user_role() AS current_user_role))::text, ''::text) = ANY (ARRAY['site_admin'::text, 'procurement'::text, 'procurement_manager'::text])) AND ((payload ->> 'event'::text) = 'wp_reopened_for_defect'::text)));

alter policy "contractors insert by staff" on public.contractors
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

alter policy "contractors readable by privileged roles" on public.contractors
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role])));

alter policy "contractors update by staff" on public.contractors
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role])));

alter policy "deliverables readable by privileged roles" on public.deliverables
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_project(deliverables.project_id) AS can_see_project)));

alter policy "equipment_categories insert by back office" on public.equipment_categories
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

alter policy "equipment_categories readable by staff" on public.equipment_categories
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_categories update by back office" on public.equipment_categories
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_items insert by back office" on public.equipment_items
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

alter policy "equipment_items readable by staff" on public.equipment_items
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_items update by back office" on public.equipment_items
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_movements insert by staff" on public.equipment_movements
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

alter policy "equipment_movements readable by staff" on public.equipment_movements
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_owners insert by back office" on public.equipment_owners
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid))));

alter policy "equipment_owners readable by staff" on public.equipment_owners
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_owners update by back office" on public.equipment_owners
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "equipment_usage_logs readable by staff" on public.equipment_usage_logs
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role])));

alter policy "labor logs readable by field and pm" on public.labor_logs
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_wp(labor_logs.work_package_id) AS can_see_wp)));

alter policy "photo_logs readable by privileged roles" on public.photo_logs
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_wp(photo_logs.work_package_id) AS can_see_wp)));

alter policy "project members readable by staff" on public.project_members
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role])));

alter policy "projects readable by privileged roles" on public.projects
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_project(projects.id) AS can_see_project)));

alter policy "insert source document by back office" on public.purchase_order_attachments
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid)) AND (superseded_by IS NULL) AND (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE (po.id = purchase_order_attachments.purchase_order_id)))));

alter policy "purchase_order_charges readable by back office" on public.purchase_order_charges
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "purchase_order_deliveries readable by back office" on public.purchase_order_deliveries
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "purchase_orders readable by back office" on public.purchase_orders
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "purchase_quotes readable by back office" on public.purchase_quotes
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "insert payment proof when purchased" on public.purchase_request_attachments
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid)) AND (purpose = 'payment'::purchase_request_attachment_purpose) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = ANY (ARRAY['purchased'::purchase_request_status, 'on_route'::purchase_request_status, 'delivered'::purchase_request_status, 'site_purchased'::purchase_request_status]))))) AND ((superseded_by IS NULL) OR pr_attachment_tombstone_target_ok(superseded_by, purchase_request_id, ( SELECT auth.uid() AS uid)))));

alter policy "insert reference while pending or confirmation when delivered" on public.purchase_request_attachments
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT auth.uid() AS uid)) AND (((purpose = 'reference'::purchase_request_attachment_purpose) AND ((EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.requested_by = ( SELECT auth.uid() AS uid)) AND (pr.status = 'requested'::purchase_request_status)))) OR (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = 'site_purchased'::purchase_request_status)))))) OR ((purpose = 'delivery_confirmation'::purchase_request_attachment_purpose) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = ANY (ARRAY['on_route'::purchase_request_status, 'delivered'::purchase_request_status])))))) OR ((purpose = 'invoice'::purchase_request_attachment_purpose) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = ANY (ARRAY['purchased'::purchase_request_status, 'on_route'::purchase_request_status, 'delivered'::purchase_request_status, 'site_purchased'::purchase_request_status])))))) OR ((purpose = 'quote'::purchase_request_attachment_purpose) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (quote_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM purchase_requests pr
  WHERE ((pr.id = purchase_request_attachments.purchase_request_id) AND (pr.status = 'approved'::purchase_request_status)))) AND (EXISTS ( SELECT 1
   FROM purchase_quotes q
  WHERE ((q.id = purchase_request_attachments.quote_id) AND (q.purchase_request_id = purchase_request_attachments.purchase_request_id)))))) AND ((superseded_by IS NULL) OR pr_attachment_tombstone_target_ok(superseded_by, purchase_request_id, ( SELECT auth.uid() AS uid)))));

alter policy "quote attachments readable by back office only" on public.purchase_request_attachments
  using (((purpose <> 'quote'::purchase_request_attachment_purpose) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role]))));

alter policy "purchase_requests insert by wp-readers" on public.purchase_requests
  with check (((requested_by = ( SELECT auth.uid() AS uid)) AND (source = 'app'::text) AND (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (((work_package_id IS NOT NULL) AND ( SELECT can_see_wp(purchase_requests.work_package_id) AS can_see_wp)) OR ((work_package_id IS NULL) AND ( SELECT can_see_project(purchase_requests.project_id) AS can_see_project)))) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])))));

alter policy "purchase_requests select own or privileged" on public.purchase_requests
  using (((requested_by = ( SELECT auth.uid() AS uid)) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_wp(purchase_requests.work_package_id) AS can_see_wp) OR ( SELECT can_see_project(purchase_requests.project_id) AS can_see_project)));

alter policy "stock_counts readable by project viewers or procurement" on public.stock_counts
  using ((( SELECT can_see_project(stock_counts.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role]))));

alter policy "stock_issues readable by project viewers or procurement" on public.stock_issues
  using ((( SELECT can_see_project(stock_issues.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR (receiver_worker_id = ( SELECT current_user_worker_id() AS current_user_worker_id))));

alter policy "stock_on_hand readable by project viewers or procurement" on public.stock_on_hand
  using ((( SELECT can_see_project(stock_on_hand.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role]))));

alter policy "stock_receipts readable by project viewers or procurement" on public.stock_receipts
  using ((( SELECT can_see_project(stock_receipts.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role]))));

alter policy "stock_returns readable by project viewers or procurement" on public.stock_returns
  using ((( SELECT can_see_project(stock_returns.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role]))));

alter policy "stock_reversals readable by project viewers or procurement" on public.stock_reversals
  using ((( SELECT can_see_project(stock_reversals.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role]))));

alter policy "suppliers insert by back office" on public.suppliers
  with check (((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])) AND (created_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid))));

alter policy "suppliers readable by staff" on public.suppliers
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "suppliers update by back office" on public.suppliers
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])))
  with check ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

alter policy "supply_plan_lines readable by project viewers" on public.supply_plan_lines
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR (EXISTS ( SELECT 1
   FROM supply_plans sp
  WHERE ((sp.id = supply_plan_lines.supply_plan_id) AND (can_see_project(sp.project_id) OR (sp.is_template AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'project_director'::user_role])))))))));

alter policy "supply_plans readable by project viewers" on public.supply_plans
  using ((( SELECT can_see_project(supply_plans.project_id) AS can_see_project) OR (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR (is_template AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['project_manager'::user_role, 'project_director'::user_role])))));

alter policy "wp_dependencies readable by privileged roles" on public.work_package_dependencies
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_wp(work_package_dependencies.predecessor_id) AS can_see_wp)));

alter policy "work_packages readable by privileged roles" on public.work_packages
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_project(work_packages.project_id) AS can_see_project)));

alter policy "worker_project_moves readable by staff" on public.worker_project_moves
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'project_director'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role])));

alter policy "workers readable by staff" on public.workers
  using ((( SELECT ( SELECT current_user_role() AS current_user_role) AS current_user_role) = ANY (ARRAY['site_admin'::user_role, 'project_manager'::user_role, 'procurement'::user_role, 'procurement_manager'::user_role, 'super_admin'::user_role, 'project_director'::user_role])));

-- Spec 261 / ADR 0070 item 3 — procurement_manager may CANCEL an approved PR
-- (approved → cancelled) only. Transition-scoped: USING pins the OLD row to
-- 'approved', WITH CHECK pins the NEW row to 'cancelled'. This admits the cancel
-- transition WITHOUT widening the PM-tier "update by pm or super" policy, so the
-- approve transition (requested → approved/rejected) stays DB-blocked for
-- procurement_manager. Permissive UPDATE policies OR together.
create policy "purchase_requests cancel by procurement_manager"
  on public.purchase_requests
  for update
  to authenticated
  using (
    (select public.current_user_role()) = 'procurement_manager'
    and status = 'approved'
  )
  with check (
    (select public.current_user_role()) = 'procurement_manager'
    and status = 'cancelled'
  );
