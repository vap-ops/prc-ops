-- Spec 198 U2 / ADR 0064 — correct the divert mechanism (supersedes the approach
-- in 20260813000900).
--
-- The 000900 plan re-enqueued a `purchase` GL job so the drain would reverse the
-- WP-WIP entry. That cannot work: post_purchase_to_gl only posts a PR whose
-- status is 'purchased'/'site_purchased' — a *delivered* PR raises P0001, so the
-- re-post never reverses and the cost would stay double-booked (WP-WIP + the new
-- Inventory receipt). pgTAP 216 caught this.
--
-- Correct mechanism: the divert RPC reverses the WP-bound purchase's posted entry
-- **directly** (reverse_journal_internal) and **skips** any still-pending purchase
-- outbox job (so it can't post WP-WIP after the divert). The receipt's own
-- enqueue/poster books Dr 1500 / Cr AP as before. Net is unchanged:
--   reverse WP purchase :  Dr 2100 AP        / Cr 1400 WP-WIP   (if it had posted)
--   new stock_receipt   :  Dr 1500 Inventory / Cr 2100 AP
--   => WP-WIP 0 · Inventory +cost · AP unchanged.
-- If the purchase had NOT posted yet (job still pending), skipping it means no
-- WP-WIP ever posts and the receipt is the sole AP booking — the P3 store-bound
-- model. Either path converges.

-- ----------------------------------------------------------------------------
-- 1. Revert post_purchase_to_gl to its pre-spec-198 body (the reverse-and-repost
--    lookup stays AFTER the WP-less suppression — 000900's reorder is no longer
--    needed since the divert reverses directly). Body verbatim from LIVE ==
--    migration 20260813000500.
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

  -- Reverse-and-repost: reverse the current (non-reversed) purchase entry, if any.
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
-- 2. divert_purchase_to_store — reverse the WP-WIP purchase entry directly + skip
--    any pending purchase job; then receive into the store + reclassify WP-less.
-- ----------------------------------------------------------------------------
create or replace function public.divert_purchase_to_store(p_request_id uuid)
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
  v_requester uuid;
  v_actor     uuid;
  v_unit      text;
  v_unit_cost numeric(12, 2);
  v_old       uuid;
  v_id        uuid;
begin
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'divert_purchase_to_store: role not permitted' using errcode = '42501';
  end if;

  select pr.project_id, pr.work_package_id, pr.catalog_item_id, pr.status::text,
         pr.quantity, pr.amount, pr.supplier_id, pr.requested_by
    into v_project, v_wp, v_item, v_status, v_qty, v_amount, v_supplier, v_requester
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

  v_actor := coalesce(auth.uid(), v_requester);

  -- 1. Reverse the WP-bound purchase's posted GL entry, if it has posted (Dr 2100
  --    AP / Cr 1400 WP-WIP). The cost leaves the WP.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'purchase_requests'
     and e.source_id    = p_request_id
     and e.source_event = 'purchase'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'spec 198 U2: diverted to store');
  end if;

  -- 2. Skip any still-pending/posting purchase job so it can't post WP-WIP after
  --    the divert (if the purchase had not drained yet, no WP-WIP ever posts).
  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'purchase_requests'
     and source_id    = p_request_id
     and source_event = 'purchase'
     and status in ('pending', 'posting');

  -- 3. Receive into the store (all-in cost; the insert auto-enqueues its Dr 1500 /
  --    Cr AP job). Mirrors record_stock_in / the P3 receipt.
  v_unit_cost := round(coalesce(v_amount, 0) / nullif(v_qty, 0), 2);
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

  -- 4. The PR becomes store-bound — it joins the WP-less population (wp_profit's
  --    WP-scoped 1400 term drops it; the cost is now Inventory).
  update public.purchase_requests set work_package_id = null where id = p_request_id;

  return v_id;
end;
$$;

comment on function public.divert_purchase_to_store(uuid) is
  'Spec 198 U2 / ADR 0064 — move a delivered WP-bound catalogued purchase into the store (SITE_STAFF gate, can_see_project). Reverses the WP-bound purchase GL entry (if posted) + skips any pending purchase job, inserts a stock_receipt (Dr 1500 / Cr AP via the receipt poster), reclassifies the PR WP-less, rolls stock_on_hand. Returns the receipt id.';
