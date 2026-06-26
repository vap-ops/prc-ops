-- Spec 208 U3b — on-site "ใช้ที่งานนี้เลย" (buy & use on this WP now): a one-tap
-- shortcut that RECEIVES a catalogued item into the project store AND immediately
-- ISSUES it to a work package, atomically (operator design pass 3, 2026-06-26).
--
-- It composes the two existing, tested posting events in ONE transaction:
--   1. receipt  → Dr 1500 Inventory / Cr 2100 AP  (post_stock_receipt_to_gl, all-in
--                 cost, VAT-agnostic — same basis as record_stock_in / the store)
--   2. issue    → Dr 1400 WP-WIP   / Cr 1500 Inventory at moving-average cost
--                 (post_stock_issue_to_gl)
-- Net GL = Dr 1400 / Cr 2100 at all-in cost. This equals a direct on-site WP
-- purchase ONLY at zero VAT: the store path is VAT-AGNOSTIC and does NOT split
-- Input VAT (1300). Spec 208 U3b option B (operator 2026-06-26): the use-now
-- shortcut is for CASH buys without a full tax invoice (no reclaimable VAT), so
-- VAT-inclusive cost is correct here; a VAT-invoiced on-site buy uses the
-- free-text on-site purchase form (record_site_purchase → post_purchase_to_gl),
-- which splits Input VAT. When the deferred Phase-2 VAT-split-at-receipt lands,
-- this shortcut inherits it. Routed through the store so the buy shows as a
-- receipt + the use as an issue (single-basis WP/Nova costing, full store
-- traceability). No new GL semantics: the existing per-row enqueue triggers on
-- stock_receipts / stock_issues fire as normal. NO double-count (the receipt
-- carries no purchase_request_id, so the spec-195-P3 auto-receipt never applies).
--
-- Catalogued items only — the store is keyed by catalog_item_id; an off-catalog
-- (free-text) on-site buy keeps the existing record_site_purchase direct path.
--
-- Gate = issue_stock's: SITE_STAFF role set + can_see_project MEMBERSHIP
-- (procurement excluded — it curates receiving, not on-site spend onto a WP).

create or replace function public.site_purchase_use_now(
  p_project_id uuid,
  p_work_package_id uuid,
  p_catalog_item_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_decrement   numeric;
  v_sell        numeric;
  v_issue_id    uuid;
begin
  -- Role + membership (issue_stock's gate; procurement excluded).
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'site_purchase_use_now: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'site_purchase_use_now: not a project member' using errcode = '42501';
  end if;
  -- The WP must belong to this project.
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'site_purchase_use_now: work package not in this project' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'site_purchase_use_now: qty must be > 0' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'site_purchase_use_now: unit_cost must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'site_purchase_use_now: unknown or inactive catalog item' using errcode = '22023';
  end if;

  -- 1) RECEIVE into the store (additive; the GL trigger books Dr 1500 / Cr 2100).
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, p_unit_cost, null,
     coalesce(v_note, 'ซื้อใช้หน้างาน'));

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * p_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 2) ISSUE to the WP at moving-average cost (the GL trigger books Dr 1400 / Cr
  --    1500). Lock the on-hand row we just rolled; sufficiency is guaranteed (we
  --    added p_qty), but keep the same lock/compute path as issue_stock.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  v_sell := coalesce(
    (select sell_rate from public.item_sell_rates where catalog_item_id = p_catalog_item_id),
    v_avg);
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
     receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_sell,
     coalesce(v_note, 'ซื้อใช้หน้างาน'), null)
  returning id into v_issue_id;

  return v_issue_id;
end;
$$;

revoke all on function public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text)
  from public, anon;
grant execute on function public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text)
  to authenticated;

comment on function public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text) is
  'Spec 208 U3b (option B) — on-site CASH buy-&-use-now: atomically receive a catalogued item into the project store (Dr 1500/Cr 2100) and immediately issue it to a WP (Dr 1400/Cr 1500 at moving-average). Net Dr 1400/Cr 2100 at all-in cost — equals a direct on-site WP purchase only at zero VAT (the store path is VAT-agnostic; VAT-invoiced buys use the free-text on-site purchase form which splits Input VAT). Gate = SITE_STAFF + can_see_project (procurement excluded). Returns the stock_issues id.';
