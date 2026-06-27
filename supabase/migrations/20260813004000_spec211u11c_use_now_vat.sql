-- Spec 211 U11c-A — VAT-invoiced "ใช้ที่งานนี้เลย": let the use-now shortcut
-- reclaim Input VAT (1300), so a catalogued buy WITH a tax invoice can be
-- received-and-used in one tap (until now only the free-text record path split
-- VAT; the use-now shortcut was cash/zero-VAT only — spec 208 U3b option B).
--
-- No new GL semantics: the receipt poster (post_stock_receipt_to_gl, spec 208 U4b)
-- ALREADY books Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross from a receipt's
-- NET total_cost + vat_rate, and its no-PR fallback reconstructs the gross as
-- round(net * (1 + rate/100), 2). A use-now receipt carries no purchase_request_id,
-- so that fallback is EXACTLY the path taken. This RPC just stores the receipt NET
-- + sets vat_rate — mirroring purchase_requests_stock_in_on_receive (spec 208 U4b §2).
--
-- p_unit_cost stays the GROSS (VAT-inclusive) cash cost paid (ADR 0045 amount=gross);
-- the RPC derives the NET inventory cost. At p_vat_rate = 0 the math is identity
-- (net == gross), so every existing cash buy-&-use is byte-identical.
--
-- SIGNATURE change (new 7th arg p_vat_rate) → DROP + CREATE (the "change-sig =
-- drop+create + re-grant + re-pin" lesson; pgTAP 228's to_regprocedure/privilege
-- pins move to the 7-arg form). The new arg has a default, so the existing caller
-- (sitePurchaseUseNow) keeps working untouched.
--
-- Money posting change on the store path → OPERATOR-SIGN-OFF (the db push is it).

drop function if exists public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text);

create or replace function public.site_purchase_use_now(
  p_project_id uuid,
  p_work_package_id uuid,
  p_catalog_item_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_note text default null,
  p_vat_rate numeric default 0
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
  v_rate        numeric := coalesce(p_vat_rate, 0);
  v_net_total   numeric(14, 2);
  v_unit_net    numeric(12, 2);
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
  if v_rate < 0 then
    raise exception 'site_purchase_use_now: vat_rate must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'site_purchase_use_now: unknown or inactive catalog item' using errcode = '22023';
  end if;

  -- Inventory carries the NET (ex-VAT) cost; reclaimable Input VAT is split to 1300
  -- by the receipt poster. p_unit_cost is the GROSS paid; with no VAT, net == gross
  -- (the prior all-in behaviour). Net derived at the TOTAL then back to a unit cost
  -- (mirrors purchase_requests_stock_in_on_receive's rounding, spec 208 U4b).
  if v_rate > 0 then
    v_net_total := round((p_qty * p_unit_cost) / (1 + v_rate / 100), 2);
  else
    v_net_total := p_qty * p_unit_cost;
  end if;
  v_unit_net := round(v_net_total / nullif(p_qty, 0), 2);

  -- 1) RECEIVE into the store at NET cost + snapshot vat_rate (the GL trigger books
  --    Dr 1500 net / Dr 1300 Input VAT when rate>0 / Cr 2100 gross).
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note, vat_rate)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, coalesce(v_unit_net, 0), null,
     coalesce(v_note, 'ซื้อใช้หน้างาน'), v_rate);

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * coalesce(v_unit_net, 0))
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

revoke all on function public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text, numeric)
  from public, anon;
grant execute on function public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text, numeric)
  to authenticated;

comment on function public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text, numeric) is
  'Spec 208 U3b + 211 U11c-A — on-site buy-&-use-now: atomically receive a catalogued item into the store (Dr 1500 net / Dr 1300 Input VAT when p_vat_rate>0 / Cr 2100 gross) and immediately issue it to a WP (Dr 1400/Cr 1500 at moving-average NET cost). p_unit_cost is the GROSS (VAT-inclusive) paid; inventory carries NET. At p_vat_rate=0 net==gross (the cash buy, unchanged). Gate = SITE_STAFF + can_see_project (procurement excluded). Returns the stock_issues id.';
