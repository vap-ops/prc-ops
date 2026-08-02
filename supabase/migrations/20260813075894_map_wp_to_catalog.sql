-- Spec 389 U4 — map_wp_to_catalog: the PD mapping RPC for legacy projects.
--
-- Writes work_packages.wp_catalog_item_id under a PD-tier gate. The one design
-- rule that is easy to lose (spec §7, recorded at the U1 review): stars are
-- keyed to the catalogue item AT STAR TIME, so a re-map MOVES the WP's stars to
-- the new item (deduping (item, photo) collisions first) and an un-map RETIRES
-- them — otherwise a starred photo keeps surfacing as reference for a work-type
-- the WP no longer represents, and unstar-by-photo would delete rows on two
-- items at once.
--
-- Audit: one row per actual change (no-ops write nothing), the house
-- action='other' + payload.event convention.

create or replace function public.map_wp_to_catalog(
  p_work_package_id uuid,
  p_wp_catalog_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  public.user_role := public.current_user_role();
  v_wp_is_group boolean;
  v_old   uuid;
  v_item_is_group boolean;
  v_item_active boolean;
  v_moved int := 0;
  v_deduped int := 0;
  v_retired int := 0;
begin
  if v_role is null or v_role not in ('project_director', 'super_admin') then
    raise exception 'map_wp_to_catalog: project_director or super_admin only'
      using errcode = '42501';
  end if;

  -- FOR UPDATE: two concurrent maps of one WP must serialize, or the loser
  -- moves stars from an item the WP no longer sits on
  select is_group, wp_catalog_item_id into v_wp_is_group, v_old
  from public.work_packages where id = p_work_package_id
  for update;
  if not found then
    raise exception 'map_wp_to_catalog: unknown work package' using errcode = '22023';
  end if;

  if p_wp_catalog_item_id is not null then
    select is_group, is_active into v_item_is_group, v_item_active
    from public.wp_catalog_items where id = p_wp_catalog_item_id;
    if not found then
      raise exception 'map_wp_to_catalog: unknown catalogue item' using errcode = '22023';
    end if;
    if not v_item_active then
      raise exception 'map_wp_to_catalog: catalogue item is retired' using errcode = '22023';
    end if;
    if v_item_is_group is distinct from v_wp_is_group then
      raise exception 'map_wp_to_catalog: group/leaf grain mismatch between WP and catalogue item'
        using errcode = '22023';
    end if;
  end if;

  -- no-op: nothing to write, nothing to audit
  if v_old is not distinct from p_wp_catalog_item_id then
    return jsonb_build_object('changed', false, 'old', v_old, 'new', p_wp_catalog_item_id,
                              'stars_moved', 0, 'stars_deduped', 0, 'stars_retired', 0);
  end if;

  update public.work_packages
    set wp_catalog_item_id = p_wp_catalog_item_id
    where id = p_work_package_id;

  -- star handling: only stars of THIS WP's photos under the OLD item are in play
  if v_old is not null then
    if p_wp_catalog_item_id is null then
      -- un-map ⇒ retire
      delete from public.wp_catalog_reference_photos s
      using public.photo_logs p
      where s.photo_log_id = p.id
        and p.work_package_id = p_work_package_id
        and s.wp_catalog_item_id = v_old;
      get diagnostics v_retired = row_count;
    else
      -- re-map ⇒ move (drop pair collisions on the target first; reported as
      -- stars_deduped, NOT stars_retired — an audit reader must be able to
      -- tell "collapsed onto an existing star" from "destroyed on un-map")
      delete from public.wp_catalog_reference_photos s
      using public.photo_logs p
      where s.photo_log_id = p.id
        and p.work_package_id = p_work_package_id
        and s.wp_catalog_item_id = v_old
        and exists (select 1 from public.wp_catalog_reference_photos t
                     where t.wp_catalog_item_id = p_wp_catalog_item_id
                       and t.photo_log_id = s.photo_log_id);
      get diagnostics v_deduped = row_count;

      update public.wp_catalog_reference_photos s
        set wp_catalog_item_id = p_wp_catalog_item_id
      from public.photo_logs p
      where s.photo_log_id = p.id
        and p.work_package_id = p_work_package_id
        and s.wp_catalog_item_id = v_old;
      get diagnostics v_moved = row_count;
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_role, 'other', 'work_packages', p_work_package_id,
    jsonb_build_object(
      'event', 'wp_catalog_mapped',
      'old_item', v_old,
      'new_item', p_wp_catalog_item_id,
      'stars_moved', v_moved,
      'stars_deduped', v_deduped,
      'stars_retired', v_retired));

  return jsonb_build_object('changed', true, 'old', v_old, 'new', p_wp_catalog_item_id,
                            'stars_moved', v_moved, 'stars_deduped', v_deduped,
                            'stars_retired', v_retired);
end;
$$;

revoke all on function public.map_wp_to_catalog(uuid, uuid) from public, anon;
grant execute on function public.map_wp_to_catalog(uuid, uuid) to authenticated;
