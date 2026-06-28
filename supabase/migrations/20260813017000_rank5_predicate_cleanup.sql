-- Architecture-quality audit rank 5 (sql-role-helpers), stage 2 — batch 5 (cleanup).
--
-- Final adoption pass for the gates that map to an existing SSOT predicate
-- (migration 20260813003200), choosing the predicate by each gate's exact role
-- SET (is_manager / is_back_office / is_site_staff). Each
--   current_user_role() not in (<exact role set, any order>)
-- becomes  not public.<predicate>(public.current_user_role()).
--
-- BEHAVIOUR-PRESERVING: every predicate is exactly its role set and pgTAP 231
-- asserts TS<->SQL parity, so access is unchanged. Bodies sourced VERBATIM from
-- LIVE via pg_get_functiondef; a set-based matcher swapped one gate per function
-- (asserted). CREATE OR REPLACE preserves grants (anon revoked; pgTAP 229).
--
-- Includes the 4 spec-219 catalog RPCs (now that #160/015000 is on main),
-- create_contractor_invite (a PM-3 gate missed in the batch-2 name list), and the
-- two is_site_staff gates. Gates whose set has NO exact predicate (accounting-set,
-- the 5-role set_work_package_contractor, the PD+super set) are intentionally left.
--
-- Functions: create_catalog_item (is_back_office), create_catalog_subcategory (is_back_office), create_contractor_invite (is_manager), enqueue_peak_sync (is_site_staff), set_work_package_notes (is_site_staff), update_catalog_item (is_back_office), update_catalog_subcategory (is_back_office).

-- create_catalog_item -> is_back_office
CREATE OR REPLACE FUNCTION public.create_catalog_item(p_category item_category, p_base_item text, p_spec_attrs text, p_unit text, p_stockable boolean, p_note text, p_product_code text DEFAULT NULL::text, p_subcategory_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id   uuid;
  v_base text := btrim(p_base_item);
  v_unit text := btrim(p_unit);
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_catalog_item: role not permitted' using errcode = '42501';
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
  -- Spec 219 — the chosen subcategory must belong to the item's main category.
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category = p_category) then
    raise exception 'create_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, base_item, spec_attrs, unit, stockable, note, product_code, subcategory_id)
    values (p_category, v_base, v_spec, v_unit, coalesce(p_stockable, true), v_note, v_code, p_subcategory_id)
    returning id into v_id;

  return v_id;
end;
$function$;

-- create_catalog_subcategory -> is_back_office
CREATE OR REPLACE FUNCTION public.create_catalog_subcategory(p_category item_category, p_code text, p_name text, p_sort_order smallint DEFAULT 0)
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
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_catalog_subcategory: role not permitted' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'create_catalog_subcategory: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_subcategory: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.catalog_subcategories (category, code, name, sort_order)
    values (p_category, v_code, v_name, coalesce(p_sort_order, 0))
    returning id into v_id;

  return v_id;
end;
$function$;

-- create_contractor_invite -> is_manager
CREATE OR REPLACE FUNCTION public.create_contractor_invite(p_contractor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_contractor_invite: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then
    raise exception 'create_contractor_invite: contractor not found' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.contractor_invites (contractor_id, token, created_by, expires_at)
  values (p_contractor_id, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

-- enqueue_peak_sync -> is_site_staff
CREATE OR REPLACE FUNCTION public.enqueue_peak_sync(p_entity_type peak_entity_type, p_source_table text, p_source_id uuid, p_operation peak_sync_operation DEFAULT 'create'::peak_sync_operation, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not public.is_site_staff(public.current_user_role()) then
    raise exception 'enqueue_peak_sync: role not permitted' using errcode = '42501';
  end if;

  select id into v_id
    from public.peak_sync_outbox
   where source_table = p_source_table
     and source_id = p_source_id
     and operation = p_operation
     and status in ('pending', 'sending')
   limit 1;
  if found then
    return v_id;
  end if;

  insert into public.peak_sync_outbox (entity_type, source_table, source_id, operation, payload)
  values (p_entity_type, p_source_table, p_source_id, p_operation, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$function$;

-- set_work_package_notes -> is_site_staff
CREATE OR REPLACE FUNCTION public.set_work_package_notes(p_work_package_id uuid, p_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_site_staff(public.current_user_role()) then
    raise exception 'set_work_package_notes: role not permitted'
      using errcode = '42501';
  end if;

  update public.work_packages
     set notes = nullif(btrim(p_notes), '')
   where id = p_work_package_id;
  return found;
end;
$function$;

-- update_catalog_item -> is_back_office
CREATE OR REPLACE FUNCTION public.update_catalog_item(p_id uuid, p_category item_category, p_base_item text, p_spec_attrs text, p_unit text, p_stockable boolean, p_note text, p_product_code text DEFAULT NULL::text, p_subcategory_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base text := btrim(p_base_item);
  v_unit text := btrim(p_unit);
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
  v_n    integer;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'update_catalog_item: role not permitted' using errcode = '42501';
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
  -- Spec 219 — the chosen subcategory must belong to the item's main category.
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category = p_category) then
    raise exception 'update_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  -- Full-replace semantics: the edit form always sends every field (pre-filled
  -- with current values), so a normal edit preserves them and clearing a field
  -- clears it.
  update public.catalog_items
     set category       = p_category,
         base_item      = v_base,
         spec_attrs     = v_spec,
         unit           = v_unit,
         stockable      = coalesce(p_stockable, true),
         note           = v_note,
         product_code   = v_code,
         subcategory_id = p_subcategory_id
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;
end;
$function$;

-- update_catalog_subcategory -> is_back_office
CREATE OR REPLACE FUNCTION public.update_catalog_subcategory(p_id uuid, p_name text, p_sort_order smallint, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_n    integer;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'update_catalog_subcategory: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_catalog_subcategory: name required (<=120)' using errcode = '22023';
  end if;

  -- Code is immutable once set (item FKs key on it); name/order/active are editable.
  update public.catalog_subcategories
     set name       = v_name,
         sort_order = coalesce(p_sort_order, 0),
         is_active  = coalesce(p_is_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_subcategory: unknown subcategory' using errcode = '22023';
  end if;
end;
$function$;
