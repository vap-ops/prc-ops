-- Spec 175 U3 — edit / deactivate a catalog item.
--
-- Two more controlled-write RPCs over catalog_items (still no table INSERT/UPDATE
-- grant — the SECURITY DEFINER functions are the sole write path, same posture as
-- create_catalog_item U2). Both role-gated to the back-office curators
-- (pm/super/procurement/director). Deactivate is a SOFT delete (is_active=false)
-- so a mistaken removal is reversible; the /catalog list shows active items only.

-- update_catalog_item — edit every field of an existing item. Trims + caps like
-- create; the unique-identity index raises 23505 if the edit collides with
-- another item; unknown id → 22023.
create function public.update_catalog_item(
  p_id         uuid,
  p_category   public.item_category,
  p_base_item  text,
  p_spec_attrs text,
  p_unit       text,
  p_stockable  boolean,
  p_note       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := btrim(p_base_item);
  v_unit text := btrim(p_unit);
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_n    integer;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
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

  update public.catalog_items
     set category   = p_category,
         base_item  = v_base,
         spec_attrs = v_spec,
         unit       = v_unit,
         stockable  = coalesce(p_stockable, true),
         note       = v_note
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;
end;
$$;

-- set_catalog_item_active — soft delete / restore.
create function public.set_catalog_item_active(
  p_id     uuid,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'set_catalog_item_active: role not permitted' using errcode = '42501';
  end if;

  update public.catalog_items
     set is_active = coalesce(p_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_catalog_item_active: unknown item' using errcode = '22023';
  end if;
end;
$$;

-- Default privileges grant EXECUTE to anon on every new function — revoke it.
revoke all on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text) from public, anon;
grant execute on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text) to authenticated;

revoke all on function public.set_catalog_item_active(uuid, boolean) from public, anon;
grant execute on function public.set_catalog_item_active(uuid, boolean) to authenticated;

comment on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text) is
  'Spec 175 U3 — edit a catalog item (back-office). Unknown id → 22023; duplicate (base_item, spec_attrs) → 23505.';
comment on function public.set_catalog_item_active(uuid, boolean) is
  'Spec 175 U3 — soft delete / restore a catalog item (back-office). Unknown id → 22023.';
