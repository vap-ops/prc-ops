-- Spec 175 U2 — add a catalog item.
--
-- catalog_items stays write-locked at the table level (no INSERT grant / no
-- write policy — reference data, spec 175 U1). The controlled write path is this
-- SECURITY DEFINER RPC, role-gated to the back-office curators
-- (pm/super/procurement/director — the BACK_OFFICE_ROLES set). Same posture as
-- apply_wp_template (spec 142). Edit / deactivate of existing items is U3.
--
-- The unique identity index (base_item, coalesce(spec_attrs,'')) raises 23505 on
-- a duplicate; the action maps it to a friendly "already exists" message.

create function public.create_catalog_item(
  p_category   public.item_category,
  p_base_item  text,
  p_spec_attrs text,
  p_unit       text,
  p_stockable  boolean,
  p_note       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_base text := btrim(p_base_item);
  v_unit text := btrim(p_unit);
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
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

  insert into public.catalog_items (category, base_item, spec_attrs, unit, stockable, note)
    values (p_category, v_base, v_spec, v_unit, coalesce(p_stockable, true), v_note)
    returning id into v_id;

  return v_id;
end;
$$;

-- Default privileges grant EXECUTE to anon on every new function (Supabase ships
-- ALTER DEFAULT PRIVILEGES … TO anon, authenticated, service_role) — revoke it
-- explicitly so anon can never call this write.
revoke all on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text) to authenticated;

comment on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text) is
  'Spec 175 U2 — add a catalog item (back-office: pm/super/procurement/director). Trims inputs; unique (base_item, spec_attrs) → 23505. Returns the new id.';
