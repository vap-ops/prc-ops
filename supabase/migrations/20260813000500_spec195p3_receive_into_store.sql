-- Spec 195 Phase 3 / ADR 0063 — receive a store-bound (WP-less) PO line into the
-- store. The missing PO → store join: when a WP-less purchase request is received
-- (status → delivered), it stocks the project store instead of completing a WP
-- delivery.
--
-- GL model (operator AskUserQuestion 2026-06-24, Option A — perpetual inventory,
-- aligned with spec 178 B6): the RECEIPT books the inventory
-- (Dr 1500 / Cr AP via the existing post_stock_receipt_to_gl), so the store-bound
-- purchase's WIP posting is SUPPRESSED — otherwise the same material would credit
-- AP twice (once at purchase, once at receipt). เบิก later moves it Dr WIP / Cr
-- Inventory (spec 177/178), so the WP's material cost lands once, at usage.
--
-- Cost basis: the receipt's unit_cost is the PR's all-in cost (amount / qty,
-- gross) — consistent with the manual store-in path (record_stock_in), which is
-- VAT-agnostic (the on-site store is cost-first; spec 177/178).

-- ----------------------------------------------------------------------------
-- 1. Trace + idempotency: a stock_receipt may originate from a purchase request.
-- ----------------------------------------------------------------------------
alter table public.stock_receipts
  add column purchase_request_id uuid references public.purchase_requests(id);

create unique index stock_receipts_pr_uniq
  on public.stock_receipts (purchase_request_id)
  where purchase_request_id is not null;

comment on column public.stock_receipts.purchase_request_id is
  'ADR 0063 / spec 195 P3 — the WP-less purchase request this receipt was auto-created from on receive (NULL = a manual/standalone stock-in). Unique: one receipt per PR.';

-- ----------------------------------------------------------------------------
-- 2. Stock-in on receive — an AFTER UPDATE trigger that, when a WP-less PR is
--    received, records a stock_receipt at the PR's all-in cost and rolls
--    stock_on_hand (mirrors record_stock_in's core; SECURITY DEFINER so it writes
--    the append-only/zero-write tables as the owner, like record_stock_in). The
--    receive action's own role gate authorises this — no separate stock-in gate.
-- ----------------------------------------------------------------------------
create function public.purchase_requests_stock_in_on_receive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit      text;
  v_unit_cost numeric(12, 2);
begin
  -- Only a store-bound (WP-less) PR with a catalog item becomes stock. A WP-bound
  -- PR completes a normal WP delivery; an off-catalog PR isn't store-trackable.
  if new.work_package_id is not null or new.catalog_item_id is null then
    return new;
  end if;
  -- Idempotent (the unique index is the hard guard; this avoids a needless error).
  if exists (
    select 1 from public.stock_receipts sr where sr.purchase_request_id = new.id
  ) then
    return new;
  end if;

  select c.unit into v_unit from public.catalog_items c where c.id = new.catalog_item_id;
  if v_unit is null then
    return new;  -- catalog item vanished — nothing to snapshot
  end if;

  -- All-in unit cost (gross), consistent with the manual store-in path.
  v_unit_cost := round(coalesce(new.amount, 0) / nullif(new.quantity, 0), 2);

  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note,
     created_by, purchase_request_id)
  values
    (new.project_id, new.catalog_item_id, new.quantity, v_unit, coalesce(v_unit_cost, 0),
     new.supplier_id, 'รับเข้าจากคำขอซื้อ', coalesce(auth.uid(), new.requested_by), new.id);

  -- Roll into on-hand (a pure stock-IN is additive), mirroring record_stock_in.
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (new.project_id, new.catalog_item_id, new.quantity,
          new.quantity * coalesce(v_unit_cost, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return new;
end;
$$;

revoke all on function public.purchase_requests_stock_in_on_receive() from public, anon;

comment on function public.purchase_requests_stock_in_on_receive() is
  'ADR 0063 / spec 195 P3 — on a WP-less PR reaching delivered, records a stock_receipt (all-in cost) + rolls stock_on_hand. The receipt''s own GL trigger books Dr Inventory 1500 / Cr AP.';

create trigger purchase_requests_stock_in_on_receive
  after update on public.purchase_requests
  for each row
  when (
    old.status is distinct from new.status
    and new.status = 'delivered'
    and new.work_package_id is null
  )
  execute function public.purchase_requests_stock_in_on_receive();

-- ----------------------------------------------------------------------------
-- 3. Suppress the WIP posting for a store-bound (WP-less) purchase — its cost is
--    booked as Inventory by the receipt (step 2). Body sourced from the LIVE
--    function (== migration 20260742000200); the only change is the WP-less guard.
--    CREATE OR REPLACE (same signature) preserves the service_role grant.
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
revoke all on function public.post_purchase_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_purchase_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Don't even enqueue a purchase GL job for a WP-less purchase (it is booked
--    as inventory at receipt). Recreate the two enqueue triggers with the extra
--    `work_package_id is not null` guard (names unchanged → existence pins hold).
-- ----------------------------------------------------------------------------
drop trigger purchase_requests_enqueue_gl_posting_ins on public.purchase_requests;
create trigger purchase_requests_enqueue_gl_posting_ins
  after insert on public.purchase_requests
  for each row
  when (new.amount is not null and new.status in ('purchased', 'site_purchased')
        and new.work_package_id is not null)
  execute function public.enqueue_gl_posting_tg('purchase', 'id');

drop trigger purchase_requests_enqueue_gl_posting_upd on public.purchase_requests;
create trigger purchase_requests_enqueue_gl_posting_upd
  after update on public.purchase_requests
  for each row
  when (new.amount is not null and new.status in ('purchased', 'site_purchased')
        and new.work_package_id is not null
        and (new.amount is distinct from old.amount or new.status is distinct from old.status))
  execute function public.enqueue_gl_posting_tg('purchase', 'id');
