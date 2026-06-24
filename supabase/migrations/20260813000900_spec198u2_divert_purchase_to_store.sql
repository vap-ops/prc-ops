-- Spec 198 U2 / ADR 0064 — divert a delivered WP-bound purchase into the store.
--
-- A delivered, WP-bound, catalogued purchase line can be moved into store stock:
-- its cost transfers WP-WIP (1400) -> Inventory (1500). A later เบิก returns it
-- Dr 1400 / Cr 1500, so the WP's material cost lands once, at usage — the
-- store-bound model (spec 195 P3). Net GL of the divert:
--   reverse WP purchase :  Dr 2100 AP        / Cr 1400 WP-WIP
--   new stock_receipt   :  Dr 1500 Inventory / Cr 2100 AP
--   => WP-WIP 0 · Inventory +cost · AP unchanged (one liability).
-- All posting flows through the existing async outbox + drain_gl_posting.

-- ----------------------------------------------------------------------------
-- 1. post_purchase_to_gl — move the reverse-and-repost lookup BEFORE the WP-less
--    suppression `return null`, so a purchase reclassified WP -> store reverses
--    its prior WP-WIP entry, then posts nothing. Inert for every existing flow:
--    a genuinely-WP-less PR never enqueues a purchase job (the enqueue triggers
--    gate on work_package_id IS NOT NULL), so this fn is never invoked for it; a
--    WP-bound re-post reverses-then-posts exactly as before. Body otherwise
--    verbatim from LIVE (== migration 20260813000500). CREATE OR REPLACE keeps
--    the service_role grant.
-- ----------------------------------------------------------------------------
create or replace function public.post_purchase_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount    numeric(14,2);
  v_vat_rate  numeric;
  v_wp        uuid;
  v_project   uuid;
  v_supplier  uuid;
  v_actor     uuid;
  v_purchased date;
  v_status    text;
  v_net       numeric(14,2);
  v_vat       numeric(14,2);
  v_old       uuid;
  v_lines     jsonb;
begin
  select amount, vat_rate, work_package_id, supplier_id,
         coalesce(requested_by, received_by_id), coalesce(purchased_at::date, current_date),
         status::text
    into v_amount, v_vat_rate, v_wp, v_supplier, v_actor, v_purchased, v_status
    from public.purchase_requests where id = p_source_id;
  if not found then
    raise exception 'post_purchase_to_gl: purchase not found' using errcode = 'P0001';
  end if;
  if v_amount is null or v_status not in ('purchased', 'site_purchased') then
    raise exception 'post_purchase_to_gl: not a postable purchase (status %, amount %)', v_status, v_amount
      using errcode = 'P0001';
  end if;

  -- Reverse-and-repost: reverse the current (non-reversed) purchase entry, if any.
  -- Spec 198 U2 / ADR 0064: done BEFORE the WP-less suppression below, so a
  -- WP -> store reclassification reverses its prior WP-WIP posting.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'purchase_requests'
     and e.source_id    = p_source_id
     and e.source_event = 'purchase'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: purchase re-posted');
  end if;

  -- Spec 195 P3 / ADR 0063: a store-bound (WP-less) purchase is NOT expensed to
  -- WIP. Its cost is booked as Inventory (Dr 1500 / Cr AP) when the material is
  -- received into the store (the stock_receipt poster). Skip the purchase posting.
  if v_wp is null then
    return null;
  end if;

  select project_id into v_project from public.work_packages where id = v_wp;

  if coalesce(v_vat_rate, 0) <= 0 then
    v_net := v_amount;
    v_vat := 0;
  else
    v_net := round(v_amount / (1 + v_vat_rate / 100), 2);
    v_vat := round(v_amount - v_net, 2);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1400', 'debit', v_net,
                       'project_id', v_project, 'work_package_id', v_wp));
  if v_vat > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1300', 'debit', v_vat,
                       'project_id', v_project, 'work_package_id', v_wp);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'credit', v_amount,
                       'supplier_id', v_supplier);

  return public.post_journal_internal(
    v_purchased, 'purchase_requests', p_source_id, 'purchase',
    'AP purchase', v_lines, null, v_actor);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. divert_purchase_to_store — the storekeeper action. SECURITY DEFINER (writes
--    the zero-grant stock tables + enqueues GL as owner). Gate SITE_STAFF (a
--    physical store-custody action; procurement is read-only in the store,
--    spec 197). Membership via can_see_project.
-- ----------------------------------------------------------------------------
create function public.divert_purchase_to_store(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      public.user_role := public.current_user_role();
  v_project   uuid;
  v_wp        uuid;
  v_item      uuid;
  v_status    text;
  v_qty       numeric;
  v_amount    numeric;
  v_supplier  uuid;
  v_unit      text;
  v_unit_cost numeric(12, 2);
  v_id        uuid;
begin
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'divert_purchase_to_store: role not permitted' using errcode = '42501';
  end if;

  select pr.project_id, pr.work_package_id, pr.catalog_item_id, pr.status::text,
         pr.quantity, pr.amount, pr.supplier_id
    into v_project, v_wp, v_item, v_status, v_qty, v_amount, v_supplier
    from public.purchase_requests pr where pr.id = p_request_id;
  if v_project is null then
    raise exception 'divert_purchase_to_store: unknown purchase request' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'divert_purchase_to_store: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'delivered' then
    raise exception 'divert_purchase_to_store: purchase is not delivered' using errcode = '22023';
  end if;
  if v_wp is null then
    raise exception 'divert_purchase_to_store: purchase is not work-package-bound' using errcode = '22023';
  end if;
  if v_item is null then
    raise exception 'divert_purchase_to_store: purchase has no catalog item' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_receipts sr where sr.purchase_request_id = p_request_id) then
    raise exception 'divert_purchase_to_store: already diverted into the store' using errcode = '22023';
  end if;

  select c.unit into v_unit from public.catalog_items c where c.id = v_item;
  if v_unit is null then
    raise exception 'divert_purchase_to_store: unknown or inactive catalog item' using errcode = '22023';
  end if;

  -- All-in unit cost (gross), consistent with P3's store-bound receipt.
  v_unit_cost := round(coalesce(v_amount, 0) / nullif(v_qty, 0), 2);

  -- 1. Receive into the store (the insert auto-enqueues its Dr 1500 / Cr AP job).
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note,
     created_by, purchase_request_id)
  values
    (v_project, v_item, v_qty, v_unit, coalesce(v_unit_cost, 0), v_supplier,
     'ย้ายเข้าคลังจากงาน', auth.uid(), p_request_id)
  returning id into v_id;

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, v_qty, v_qty * coalesce(v_unit_cost, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 2. The PR becomes store-bound — it joins the WP-less population. Its WP-WIP
  --    posting is undone by the re-post job below (post_purchase_to_gl reverses
  --    then suppresses); wp_profit's GL-materials term drops it (WP-scoped 1400).
  update public.purchase_requests set work_package_id = null where id = p_request_id;

  -- 3. Re-enqueue the purchase posting. On drain, post_purchase_to_gl reverses the
  --    old WP-WIP entry (if posted) and, seeing WP-less, posts nothing. If the
  --    original job had not drained yet, it now suppresses against the WP-less PR
  --    (no WP-WIP ever). Either path converges to the transfer above.
  perform public.enqueue_gl_posting('purchase_requests', p_request_id, 'purchase');

  return v_id;
end;
$$;

revoke all on function public.divert_purchase_to_store(uuid) from public, anon;
grant execute on function public.divert_purchase_to_store(uuid) to authenticated;

comment on function public.divert_purchase_to_store(uuid) is
  'Spec 198 U2 / ADR 0064 — move a delivered WP-bound catalogued purchase into the store (SITE_STAFF gate, can_see_project). Inserts a stock_receipt (cost transfers WP-WIP -> Inventory via the receipt poster + a reverse re-post), reclassifies the PR WP-less, rolls stock_on_hand. Returns the receipt id.';
