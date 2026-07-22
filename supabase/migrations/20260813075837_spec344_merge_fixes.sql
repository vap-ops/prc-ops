-- Spec 344 U1 — two corrections to merge_catalog_items, both from the fresh-eyes
-- fact-check of the spec (2026-07-23). `075836` is already applied, so this is a
-- NEW migration rather than an edit to it.
--
-- 1. catalog_assembly_components carries a composite unique index the first cut
--    missed — `cac_unique_component (assembly_id, component_item_id)`. The
--    component-side repoint was deduped; the ASSEMBLY-side repoint was not, and
--    neither side guarded the self-referential (keep, keep) row that appears when
--    the two merged items sit on opposite ends of the same assembly. The table is
--    empty today (0 rows), so nothing live is affected — but the RPC is permanent
--    and this is a 23505 waiting for the first assembly.
-- 2. The audit convention here is `action = 'other'` with the name in
--    `payload->>'event'` — 467 live rows across 10 distinct events follow it. The
--    first cut used `action = 'update'` + `payload->>'op'`, which no reader looks
--    for. NOTE: the audit_log SELECT policy that keys on `payload->>'event'` is an
--    ALLOWLIST of two WP events, so this row is readable by super_admin /
--    project_director / project_manager / accounting only. That is correct for a
--    super_admin-only repair tool; procurement_manager not seeing it is deliberate.

create or replace function public.merge_catalog_items(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role   text := public.current_user_role()::text;
  v_keep   public.catalog_items;
  v_drop   public.catalog_items;
  v_deltas jsonb;
begin
  -- Moving inventory between catalog rows is data repair, not catalog curation:
  -- deliberately NARROWER than create_catalog_item's curator gate.
  if v_role is distinct from 'super_admin' then
    raise exception 'merge_catalog_items: role not permitted' using errcode = '42501';
  end if;

  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'merge_catalog_items: keep and drop must differ' using errcode = '22023';
  end if;

  select * into v_keep from public.catalog_items where id = p_keep;
  select * into v_drop from public.catalog_items where id = p_drop for update;
  if v_keep.id is null or v_drop.id is null then
    raise exception 'merge_catalog_items: item not found' using errcode = '22023';
  end if;

  if v_drop.is_active is not true or v_drop.merged_into is not null then
    raise exception 'merge_catalog_items: drop item is already retired' using errcode = '22023';
  end if;

  -- An in-flight order against the losing row would receive stock into a retired
  -- item, and its receipt is append-only once written. Close or cancel first.
  if exists (
       select 1 from public.purchase_requests
        where catalog_item_id = p_drop
          and status not in ('delivered', 'cancelled', 'rejected')) then
    raise exception 'merge_catalog_items: drop item still has open purchase requests'
      using errcode = '22023';
  end if;

  -- Recorded before the fold, for the audit row: what moved, per project.
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_id', project_id, 'qty', qty_on_hand, 'value', total_value)), '[]'::jsonb)
    into v_deltas
    from public.stock_on_hand
   where catalog_item_id = p_drop;

  -- 1. stock_on_hand — PK (project_id, catalog_item_id), so a repoint would 23505
  --    wherever both sides stock the same project. Sum into the survivor, then
  --    move the projects it does not yet hold, then drop the remainder. The
  --    global sum is untouched, which is what inventory_1500 ties GL 1500 to.
  update public.stock_on_hand k
     set qty_on_hand = k.qty_on_hand + d.qty_on_hand,
         total_value = k.total_value + d.total_value,
         updated_at  = now()
    from public.stock_on_hand d
   where k.catalog_item_id = p_keep
     and d.catalog_item_id = p_drop
     and d.project_id      = k.project_id;

  update public.stock_on_hand d
     set catalog_item_id = p_keep,
         updated_at      = now()
   where d.catalog_item_id = p_drop
     and not exists (select 1 from public.stock_on_hand k
                      where k.catalog_item_id = p_keep
                        and k.project_id      = d.project_id);

  delete from public.stock_on_hand where catalog_item_id = p_drop;

  -- 2. supply_plan_lines — forward-looking plan, not history. Unique on
  --    (supply_plan_id, catalog_item_id, coalesce(work_package_id, …)); drop the
  --    loser's line where the survivor already holds that identity, else repoint.
  delete from public.supply_plan_lines d
   where d.catalog_item_id = p_drop
     and exists (
       select 1 from public.supply_plan_lines k
        where k.catalog_item_id = p_keep
          and k.supply_plan_id  = d.supply_plan_id
          and coalesce(k.work_package_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(d.work_package_id, '00000000-0000-0000-0000-000000000000'::uuid));

  update public.supply_plan_lines set catalog_item_id = p_keep where catalog_item_id = p_drop;

  -- 3. Template lines follow the survivor (no triggers, no history).
  update public.boq_line set catalog_item_id = p_keep where catalog_item_id = p_drop;

  -- 3b. Assemblies — `cac_unique_component (assembly_id, component_item_id)` makes
  --     BOTH repoints collide-able, and merging the two ends of one assembly would
  --     otherwise mint a (keep, keep) row that means "contains itself".
  delete from public.catalog_assembly_components d
   where d.component_item_id = p_drop
     and (d.assembly_id = p_keep
          or exists (select 1 from public.catalog_assembly_components k
                      where k.assembly_id       = d.assembly_id
                        and k.component_item_id = p_keep));
  update public.catalog_assembly_components set component_item_id = p_keep
   where component_item_id = p_drop;

  delete from public.catalog_assembly_components d
   where d.assembly_id = p_drop
     and (d.component_item_id = p_keep
          or exists (select 1 from public.catalog_assembly_components k
                      where k.assembly_id       = p_keep
                        and k.component_item_id = d.component_item_id));
  update public.catalog_assembly_components set assembly_id = p_keep
   where assembly_id = p_drop;

  -- 4. item_sell_rates — PK is catalog_item_id. The survivor's rate is the one a
  --    human set on the row that survives; move the loser's only if there is none.
  update public.item_sell_rates set catalog_item_id = p_keep
   where catalog_item_id = p_drop
     and not exists (select 1 from public.item_sell_rates where catalog_item_id = p_keep);
  delete from public.item_sell_rates where catalog_item_id = p_drop;

  -- 5. Memberships: the survivor owns its own is_primary row, and
  --    catalog_item_categories_one_primary would reject a repoint of the loser's.
  delete from public.catalog_item_categories where catalog_item_id = p_drop;

  -- 6. Retire, never hard-delete: the ledger rows below still name this id, and
  --    18 read sites join catalog_items to render a historical row's name.
  update public.catalog_items
     set is_active = false,
         merged_into = p_keep
   where id = p_drop;

  -- audit_action is a governed enum with no merge-shaped value; the live
  -- convention for a named event is action='other' + payload->>'event'.
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    auth.uid(),
    public.current_user_role(),
    'other',
    'catalog_items',
    p_drop,
    jsonb_build_object(
      'event', 'catalog_item_merged',
      'keep_id', p_keep,
      'drop_id', p_drop,
      'keep_name', concat_ws(' ', v_keep.base_item, v_keep.spec_attrs),
      'drop_name', concat_ws(' ', v_drop.base_item, v_drop.spec_attrs),
      'moved_stock', v_deltas));
end;
$function$;

revoke all on function public.merge_catalog_items(uuid, uuid) from public, anon;
grant execute on function public.merge_catalog_items(uuid, uuid) to authenticated;
