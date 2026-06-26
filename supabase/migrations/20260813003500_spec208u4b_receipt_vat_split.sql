-- Spec 208 Phase 2 (U4b) / ADR 0065 — store-only procurement: Input-VAT split at
-- RECEIPT.
--
-- Under ADR 0065 every purchase routes through the store, so a VAT-registered
-- purchase no longer books reclaimable Input VAT (1300) at the purchase posting
-- (post_purchase_to_gl) — it never posts that arm for a store-bound PR. The
-- reclaimable VAT must therefore be split at the RECEIPT, or it would be buried in
-- Inventory 1500 (Input VAT understated, VAT overpaid — and silently, because the
-- entry still balances and gl_reconciliation stays green).
--
-- The fix: snapshot the originating PR's vat_rate onto the stock_receipt, store the
-- inventory unit_cost NET of VAT, and have the receipt poster book
--   Dr 1500 net + Dr 1300 Input VAT + Cr 2100 gross   (when vat_rate > 0)
-- exactly mirroring what post_purchase_to_gl did at purchase time. A zero-VAT
-- receipt (vat_rate = 0, incl. every manual record_stock_in) is unchanged:
-- net == gross, no 1300 line. ALREADY-posted receipts carry vat_rate 0 (the column
-- default), so reposting one is behaviour-preserving.
--
-- Additive: one nullable column (defaulted), two CREATE OR REPLACE (same
-- signatures → grants preserved). No data backfill. Marked OPERATOR-SIGN-OFF in
-- the spec because it changes GL posting on real money — the db push is the
-- sign-off.

-- ----------------------------------------------------------------------------
-- 1. Snapshot the originating purchase's VAT rate on the receipt. Default 0 so a
--    manual stock-in (record_stock_in) and every pre-existing receipt are
--    VAT-agnostic exactly as before (cost-first store, spec 177/178).
-- ----------------------------------------------------------------------------
alter table public.stock_receipts
  add column vat_rate numeric not null default 0;

comment on column public.stock_receipts.vat_rate is
  'ADR 0065 / spec 208 U4b — the originating purchase request''s VAT rate (%), snapshot at receipt. 0 for a manual stock-in. When > 0 the receipt poster splits Dr 1300 Input VAT out of the gross; unit_cost/total_cost are the NET (ex-VAT) inventory cost.';

-- ----------------------------------------------------------------------------
-- 2. Stock-in-on-receive trigger: snapshot vat_rate and store the NET unit cost.
--    (Body == 20260813000500 §2 with the VAT-aware cost + vat_rate capture; the
--    WP-less + catalogued guard and idempotency are unchanged.) CREATE OR REPLACE
--    keeps the revoke posture; the trigger binding is untouched.
-- ----------------------------------------------------------------------------
create or replace function public.purchase_requests_stock_in_on_receive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit      text;
  v_rate      numeric := coalesce(new.vat_rate, 0);
  v_net_total numeric(14, 2);
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

  -- Inventory carries the NET (ex-VAT) cost; reclaimable Input VAT is split to 1300
  -- by the receipt poster. With no VAT, net == gross (the prior all-in behaviour).
  if v_rate > 0 then
    v_net_total := round(coalesce(new.amount, 0) / (1 + v_rate / 100), 2);
  else
    v_net_total := coalesce(new.amount, 0);
  end if;
  v_unit_cost := round(v_net_total / nullif(new.quantity, 0), 2);

  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note,
     created_by, purchase_request_id, vat_rate)
  values
    (new.project_id, new.catalog_item_id, new.quantity, v_unit, coalesce(v_unit_cost, 0),
     new.supplier_id, 'รับเข้าจากคำขอซื้อ', coalesce(auth.uid(), new.requested_by), new.id, v_rate);

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
  'ADR 0063/0065 / spec 195 P3 + 208 U4b — on a WP-less PR reaching delivered, records a stock_receipt (NET cost ex-VAT) + snapshots vat_rate + rolls stock_on_hand. The receipt''s GL poster books Dr 1500 net / Dr 1300 Input VAT / Cr AP gross.';

-- ----------------------------------------------------------------------------
-- 3. Receipt poster: split Input VAT (1300) out of the gross when vat_rate > 0.
--    (Body == 20260809001900 §post_stock_receipt_to_gl with the VAT decomposition;
--    reverse-and-repost and the supplier dimension are unchanged.) Same signature
--    → the service_role grant is preserved; re-asserted below for clarity.
-- ----------------------------------------------------------------------------
create or replace function public.post_stock_receipt_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project  uuid;
  v_net      numeric(16,2);
  v_rate     numeric;
  v_vat      numeric(16,2);
  v_gross    numeric(16,2);
  v_pr       uuid;
  v_pr_gross numeric(16,2);
  v_supplier uuid;
  v_actor    uuid;
  v_at       date;
  v_old      uuid;
  v_lines    jsonb;
begin
  -- total_cost is the NET (ex-VAT) inventory value (qty * unit_cost); vat_rate is
  -- the snapshot of the purchase's VAT rate (0 for manual stock-ins).
  select project_id, total_cost, coalesce(vat_rate, 0), supplier_id, created_by,
         coalesce(received_at::date, current_date), purchase_request_id
    into v_project, v_net, v_rate, v_supplier, v_actor, v_at, v_pr
    from public.stock_receipts where id = p_source_id;
  if not found then
    raise exception 'post_stock_receipt_to_gl: receipt not found' using errcode = 'P0001';
  end if;

  -- AP must equal the supplier invoice EXACTLY. For a VAT purchase the gross is the
  -- originating PR's all-in amount; Input VAT is the residual (gross − net), so AP
  -- never drifts from the invoice on a per-unit rounding (a multi-unit line would
  -- otherwise book a phantom satang). Net stays the inventory value, so the entry
  -- still balances (net + (gross−net) = gross) and the 1500↔on-hand tie holds.
  if v_rate > 0 then
    if v_pr is not null then
      select amount into v_pr_gross from public.purchase_requests where id = v_pr;
    end if;
    -- Fallback (no PR, e.g. a future manual VAT receipt): reconstruct the gross.
    v_gross := coalesce(v_pr_gross, round(v_net * (1 + v_rate / 100), 2));
    v_vat   := v_gross - v_net;
  else
    v_vat   := 0;
    v_gross := v_net;
  end if;

  -- Reverse-and-repost: reverse the current (non-reversed) entry for this receipt.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_receipts'
     and e.source_id    = p_source_id
     and e.source_event = 'stock_receive'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: stock receipt re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1500', 'debit', v_net, 'project_id', v_project));
  if v_vat > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1300', 'debit', v_vat,
                       'project_id', v_project);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'credit', v_gross,
                       'supplier_id', v_supplier);

  return public.post_journal_internal(
    v_at, 'stock_receipts', p_source_id, 'stock_receive', 'รับเข้าสโตร์', v_lines, null, v_actor);
end;
$$;

revoke all on function public.post_stock_receipt_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_receipt_to_gl(uuid) to service_role;

comment on function public.post_stock_receipt_to_gl(uuid) is
  'ADR 0065 / spec 208 U4b — books a stock receipt: Dr 1500 net Inventory / Dr 1300 Input VAT (when vat_rate>0) / Cr 2100 AP gross. total_cost is the NET inventory cost; VAT is reclaimable, not inventory cost. Zero-VAT (manual stock-in) = net==gross, no 1300 line.';
