-- Spec 208 (U5 prep) / ADR 0064 + 0065 — make divert_purchase_to_store VAT-correct.
--
-- divert moves a delivered WP-bound purchase into the store: it reverses the WP
-- purchase's posted entry (which had split Input VAT to 1300 at purchase) and
-- books a fresh stock_receipt. Today that receipt is booked at the all-in GROSS
-- with no vat_rate, so the receipt poster credits the whole gross to Inventory
-- 1500 and the reclaimable Input VAT — removed by the reversal — is never
-- re-split. Net effect: ~7% of the cost is buried in inventory and Input VAT (1300)
-- is understated. This is the same defect U4b fixes for the receive path
-- (20260813003500); divert must match.
--
-- Fix: snapshot the PR's vat_rate onto the receipt and store the NET (ex-VAT)
-- unit_cost, exactly like the U4b receive trigger. The U4b receipt poster then
-- books Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross. Net across reverse +
-- receipt: WP-WIP → 0 · Input VAT preserved · Inventory + net · AP one liability.
--
-- Depends on 20260813003500 (stock_receipts.vat_rate + the VAT-splitting receipt
-- poster). Additive: one CREATE OR REPLACE, same signature → grants preserved.
-- Body == 20260813001000 §2 with vat_rate capture + net cost (the only change).

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
  v_rate      numeric;
  v_net_total numeric(14, 2);
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
         pr.quantity, pr.amount, coalesce(pr.vat_rate, 0), pr.supplier_id, pr.requested_by
    into v_project, v_wp, v_item, v_status, v_qty, v_amount, v_rate, v_supplier, v_requester
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

  -- 1. Reverse the WP-bound purchase's posted GL entry, if it has posted (this
  --    undoes Dr 1400 net + Dr 1300 Input VAT + Cr 2100 gross). The cost — and the
  --    Input VAT — leave the WP entry; the receipt re-books both (step 3).
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
  --    the divert.
  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'purchase_requests'
     and source_id    = p_request_id
     and source_event = 'purchase'
     and status in ('pending', 'posting');

  -- 3. Receive into the store at NET cost (ex-VAT) + snapshot vat_rate, so the
  --    receipt poster splits Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross
  --    (U4b). With no VAT, net == gross — the prior all-in behaviour.
  if v_rate > 0 then
    v_net_total := round(coalesce(v_amount, 0) / (1 + v_rate / 100), 2);
  else
    v_net_total := coalesce(v_amount, 0);
  end if;
  v_unit_cost := round(v_net_total / nullif(v_qty, 0), 2);
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note,
     created_by, purchase_request_id, vat_rate)
  values
    (v_project, v_item, v_qty, v_unit, coalesce(v_unit_cost, 0), v_supplier,
     'ย้ายเข้าคลังจากงาน', auth.uid(), p_request_id, v_rate)
  returning id into v_id;

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, v_qty, v_qty * coalesce(v_unit_cost, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 4. The PR becomes store-bound — it joins the WP-less population.
  update public.purchase_requests set work_package_id = null where id = p_request_id;

  return v_id;
end;
$$;

comment on function public.divert_purchase_to_store(uuid) is
  'Spec 198 U2 / ADR 0064 + 0065 (U5) — move a delivered WP-bound catalogued purchase into the store (SITE_STAFF gate, can_see_project). Reverses the WP-bound purchase GL entry (if posted) + skips any pending purchase job, inserts a stock_receipt at NET cost + vat_rate so the receipt poster splits Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross, reclassifies the PR WP-less, rolls stock_on_hand. Returns the receipt id.';
