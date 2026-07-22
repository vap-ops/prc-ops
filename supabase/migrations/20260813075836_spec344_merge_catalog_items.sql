-- Spec 344 U1 — merge two catalog rows that are the same product.
--
-- The spec-208 U5 store-first backfill minted a fresh catalog item per free-text
-- purchase_requests.item_description instead of matching the structured row that
-- already existed, leaving 27 duplicate pairs live at 2026-07-23: one side holds
-- the spec in `spec_attrs`, the other bakes it into `base_item`. The existing
-- catalog_items_identity_uniq is exact-string on (base_item, coalesce(spec_attrs,''))
-- so the two shapes never collide.
--
-- WHY THIS IS A FOLD-AND-RETIRE AND NOT A REPOINT: the stock ledger is
-- append-only and says so in triggers —
--   stock_receipts / stock_returns / stock_reversals / stock_counts
--     BEFORE DELETE OR UPDATE → P0001 'append-only (correct via reversal, never mutate)'
--   stock_issues_freeze_ledger names catalog_item_id in its frozen-column list
--   purchase_requests UPDATE fires enqueue_gl_posting_upd + notify_status_change
--                                  + stock_in_on_receive
-- so the historical record cannot move, and should not: those movements really
-- did happen under that catalog id. What moves is the operational balance and
-- the forward-looking rows. `merged_into` is the thread back, so a reader can
-- union the retired row's history under the survivor.

alter table public.catalog_items
  add column if not exists merged_into uuid references public.catalog_items (id);

comment on column public.catalog_items.merged_into is
  'Spec 344: set on the RETIRED side of a merge_catalog_items() call, naming the '
  'surviving item. The retired row keeps its append-only ledger rows, so readers '
  'keyed on catalog_item_id resolve {id} ∪ {x : x.merged_into = id} to show a '
  'balance and the movements that explain it.';

create index if not exists catalog_items_merged_into_idx
  on public.catalog_items (merged_into)
  where merged_into is not null;

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

  -- 3. Template / assembly references follow the survivor (no triggers, no history).
  update public.boq_line set catalog_item_id = p_keep where catalog_item_id = p_drop;

  delete from public.catalog_assembly_components d
   where d.component_item_id = p_drop
     and exists (select 1 from public.catalog_assembly_components k
                  where k.assembly_id       = d.assembly_id
                    and k.component_item_id = p_keep);
  update public.catalog_assembly_components set component_item_id = p_keep where component_item_id = p_drop;
  update public.catalog_assembly_components set assembly_id       = p_keep where assembly_id       = p_drop;

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

  -- audit_action is a governed enum with no merge-shaped value; widening it for a
  -- repair tool would trip the exhaustiveness guards for nothing, so the
  -- discriminator lives in the payload.
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    auth.uid(),
    public.current_user_role(),
    'update',
    'catalog_items',
    p_drop,
    jsonb_build_object(
      'op', 'merge_catalog_items',
      'keep_id', p_keep,
      'drop_id', p_drop,
      'keep_name', concat_ws(' ', v_keep.base_item, v_keep.spec_attrs),
      'drop_name', concat_ws(' ', v_drop.base_item, v_drop.spec_attrs),
      'moved_stock', v_deltas));
end;
$function$;

revoke all on function public.merge_catalog_items(uuid, uuid) from public, anon;
grant execute on function public.merge_catalog_items(uuid, uuid) to authenticated;

comment on function public.merge_catalog_items(uuid, uuid) is
  'Spec 344: fold a duplicate catalog row into its twin — moves stock_on_hand '
  '(summing per project), supply_plan_lines, boq_line, catalog_assembly_components '
  'and item_sell_rates onto p_keep, then retires p_drop with merged_into set. '
  'super_admin only. The append-only stock ledger and purchase_requests are left '
  'pointing at p_drop by design.';
