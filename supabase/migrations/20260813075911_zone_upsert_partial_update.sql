-- Spec 392 — `upsert_project_zone` must not erase what the caller did not send.
--
-- THE BUG (found by fresh-eyes review of U2b, the drawing canvas; confirmed
-- against the live function body before writing a line of this file). The
-- UPDATE arm shipped in `20260813075905` was an unconditional overwrite:
--
--     set code = btrim(p_code), name = btrim(p_name),
--         shape = p_shape, geometry = p_geometry,
--         parent_zone_id = p_parent_zone_id,
--         sort_order = coalesce(p_sort_order, 0)
--
-- and `zone-sheet.tsx` — the U2a rename/re-code sheet, the ONLY other caller —
-- sends {zoneId, code, name} and nothing else, so `saveZone` filled the gaps
-- with `shape = 'rect'` and a default box. **Renaming a zone therefore reset
-- its drawn shape and position to the same default rect, nulled its parent, and
-- zeroed its sort order.**
--
-- It has been live since #958 and was harmless only because `project_zones`
-- held 0 rows in every project. U2b — the canvas that finally lets a manager
-- draw — is what arms it: the first typo fix after the first drawing erases the
-- drawing. Shipping this migration AHEAD of the canvas, on the operator's call,
-- so the hole closes independently of that unit.
--
-- THE FIX. A NULL now means "leave this column alone". Non-null still writes,
-- so the canvas (which always sends geometry) is unaffected, and so is the
-- create arm, which is untouched below.
--
-- ⚖️ `parent_zone_id` is coalesced too, which means this RPC can no longer
-- UN-nest a zone. That is deliberate and it costs nothing shipped: nothing in
-- the UI nests or un-nests today (`zone-sheet.tsx` exposes no parent picker;
-- nesting is reachable only by calling this RPC directly), while leaving parent
-- writable-to-null is exactly the arm that silently flattened the tree on every
-- rename. An explicit un-nest belongs with the affordance that needs it.
--
-- Pinned by `supabase/tests/database/398-zone-upsert-partial.test.sql`, whose
-- rename assertion carries a positive control — without one, "the shape
-- survived" would pass equally well on an update that did nothing at all.
--
-- `create or replace` preserves the existing ACL, but the revoke/grant pair is
-- restated below because a brand-new function is born executable by PUBLIC
-- (which includes anon), and a reader of this file should not have to know
-- which of those two cases they are looking at.

create or replace function public.upsert_project_zone(
  p_map_id uuid,
  p_zone_id uuid,
  p_code text,
  p_name text,
  p_shape public.zone_shape,
  p_geometry jsonb,
  p_parent_zone_id uuid default null,
  -- ⚠️ The DEFAULT moves from 0 to NULL, and it has to. Once the UPDATE arm
  -- reads NULL as "leave alone", a default of 0 reintroduces the whole bug for
  -- any caller that simply OMITS the argument — the natural six-argument
  -- shorthand now that shape and geometry are nullable — sending a zone back to
  -- the top of its map on a rename. The CREATE arm coalesces to 0 itself, so
  -- nothing downstream needs the old default.
  p_sort_order integer default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_project uuid;
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'upsert_project_zone: role not permitted' using errcode = '42501';
  end if;

  select project_id into v_project from public.project_zone_maps where id = p_map_id;
  if v_project is null then
    raise exception 'upsert_project_zone: map not found' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'upsert_project_zone: not a member of this project' using errcode = '42501';
  end if;

  -- A parent must live on the SAME map, or the nesting would cross projects.
  if p_parent_zone_id is not null
     and not exists (select 1 from public.project_zones
                      where id = p_parent_zone_id and map_id = p_map_id) then
    raise exception 'upsert_project_zone: parent zone is not on this map' using errcode = '22023';
  end if;

  -- The CREATE arm is unchanged: a new zone genuinely needs a shape and a
  -- geometry, and the NOT NULL columns say so.
  if p_zone_id is null then
    insert into public.project_zones
      (map_id, project_id, code, name, shape, geometry, parent_zone_id, sort_order, created_by)
    values
      (p_map_id, v_project, btrim(p_code), btrim(p_name), p_shape, p_geometry,
       p_parent_zone_id, coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  -- The UPDATE arm is the fix. `code` and `name` stay unconditional: every
  -- caller sends them and they are what an update is usually FOR.
  update public.project_zones
     set code           = btrim(p_code),
         name           = btrim(p_name),
         shape          = coalesce(p_shape, shape),
         geometry       = coalesce(p_geometry, geometry),
         parent_zone_id = coalesce(p_parent_zone_id, parent_zone_id),
         sort_order     = coalesce(p_sort_order, sort_order)
   where id = p_zone_id and map_id = p_map_id
  returning id into v_id;

  if v_id is null then
    raise exception 'upsert_project_zone: zone not found on this map' using errcode = '22023';
  end if;
  return v_id;
end;
$function$;

revoke all on function public.upsert_project_zone(uuid, uuid, text, text, public.zone_shape, jsonb, uuid, integer) from public, anon;
grant execute on function public.upsert_project_zone(uuid, uuid, text, text, public.zone_shape, jsonb, uuid, integer) to authenticated;
