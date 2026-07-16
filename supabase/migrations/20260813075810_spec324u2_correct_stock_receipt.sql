-- Spec 324 U2 — correct_stock_receipt: the back-office partial receipt-cost
-- correction, restricted to the fresh-pool window; plus the mutual guard +
-- dangling-flag auto-resolver on reverse_stock_receipt.
--
-- correct_stock_receipt trues an over-accepted receipt DOWN to what actually
-- arrived. It removes the surplus from stock_on_hand (at the receipt's own net
-- unit cost) and records an append-only stock_receipt_corrections row (the SSOT
-- of "actually received"); the VAT-residual GL contra rides on the AFTER-INSERT
-- enqueue trigger added in U3. NOTE: this RPC must NOT go live before U3 — a
-- U2-only window would decrement on-hand with no GL contra.
--
-- Preconditions (spec §5), all before any write:
--   1. null-safe back-office role gate + non-empty reason
--   2. origin refuse: a use-now receipt (received+issued in one txn) — the note
--      marker; the fresh-pool gate below backstops a custom-note use-now
--   3. not already fully unwound by a reversal
--   4. under the on-hand FOR UPDATE lock: fresh-pool (no issue/return/count since
--      received_at) + qty/value floors
--   5. range vs the CURRENT effective qty (booked − already-corrected) so multiple
--      corrections compose and on-hand ends exactly at true_qty
-- Removed amounts are VAT-residual (Cr1500 net / Cr1300 vat / Dr2100 gross in U3);
-- on-hand.total_value drops by the IDENTICAL rounded removed_net.
--
-- reverse_stock_receipt is re-sourced from its LIVE body (2026-07-16) + two edits:
--   (a) refuse a receipt that already has a stock_receipt_corrections row (mutual
--       guard — the two must never double-remove one receipt);
--   (b) auto-resolve any PENDING receipt_correction_requests for the receipt to
--       'obsolete' (the BO queue must never accumulate un-actionable ghosts).

-- ---------------------------------------------------------------------------
create function public.correct_stock_receipt(
  p_receipt_id uuid,
  p_true_qty   numeric,
  p_reason     text,
  p_request_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role          public.user_role := public.current_user_role();
  v_reason        text := nullif(btrim(coalesce(p_reason, '')), '');
  v_project       uuid;
  v_item          uuid;
  v_qty           numeric;
  v_unit_cost     numeric;
  v_vat_rate      numeric;
  v_total_cost    numeric;
  v_supplier      uuid;
  v_received_at   timestamptz;
  v_note          text;
  v_cum_qty       numeric;
  v_cum_net       numeric;
  v_current_qty   numeric;
  v_removed_qty   numeric;
  v_removed_net   numeric;
  v_removed_vat   numeric;
  v_removed_gross numeric;
  v_on_hand       numeric;
  v_value         numeric;
  v_id            uuid;
begin
  -- 1. Role gate (null-safe, back-office only) + reason.
  if v_role is null or not public.is_back_office(v_role) then
    raise exception 'correct_stock_receipt: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'correct_stock_receipt: reason required' using errcode = 'P0001';
  end if;

  -- 2. Load the immutable receipt.
  select project_id, catalog_item_id, qty, unit_cost, coalesce(vat_rate, 0),
         total_cost, supplier_id, received_at, note
    into v_project, v_item, v_qty, v_unit_cost, v_vat_rate,
         v_total_cost, v_supplier, v_received_at, v_note
    from public.stock_receipts where id = p_receipt_id;
  if v_project is null then
    raise exception 'correct_stock_receipt: unknown receipt' using errcode = '22023';
  end if;

  -- 2b. Membership scope — PARITY with reverse_stock_receipt (the sibling
  --     inventory+AP unwind): a project_manager may only correct a project they
  --     can see; procurement / procurement_manager (and the see-all tiers via
  --     can_see_project) are cross-project by design.
  if not (public.can_see_project(v_project) or v_role in ('procurement', 'procurement_manager')) then
    raise exception 'correct_stock_receipt: not a project member' using errcode = '42501';
  end if;

  -- 3. Origin refuse — use-now (received + issued in one txn). Marker = the
  --    site_purchase_use_now default note; custom-note use-now is caught by the
  --    fresh-pool gate (its coincident issue).
  if coalesce(v_note, '') = 'ซื้อใช้หน้างาน' then
    raise exception 'correct_stock_receipt: ไม่รองรับใบรับแบบซื้อใช้หน้างาน' using errcode = 'P0001';
  end if;

  -- 4. Not already unwound by a full reversal (would double-remove).
  if exists (select 1 from public.stock_reversals where receipt_id = p_receipt_id) then
    raise exception 'correct_stock_receipt: receipt already reversed' using errcode = 'P0001';
  end if;

  -- 5. Lock the pool; all corrections for this (project,item) serialize here.
  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null then
    raise exception 'correct_stock_receipt: no on-hand pool for this item' using errcode = '22023';
  end if;

  -- Fresh-pool window: nothing drew or re-blended this item since the receipt.
  if exists (select 1 from public.stock_issues  s where s.project_id = v_project and s.catalog_item_id = v_item and s.created_at >= v_received_at)
     or exists (select 1 from public.stock_returns r where r.project_id = v_project and r.catalog_item_id = v_item and r.created_at >= v_received_at)
     or exists (select 1 from public.stock_counts  c where c.project_id = v_project and c.catalog_item_id = v_item and c.counted_at >= v_received_at)
  then
    raise exception 'correct_stock_receipt: ของถูกเบิก/คืน/ปรับ pool ไปแล้ว — กลับรายการเบิกก่อน หรือใช้ตรวจนับ' using errcode = '22023';
  end if;

  -- 6. Range vs the CURRENT effective qty (booked minus already-corrected).
  select coalesce(sum(removed_qty), 0), coalesce(sum(removed_net), 0)
    into v_cum_qty, v_cum_net
    from public.stock_receipt_corrections where receipt_id = p_receipt_id;
  v_current_qty := v_qty - v_cum_qty;
  if p_true_qty is null or p_true_qty < 0 or p_true_qty >= v_current_qty then
    raise exception 'correct_stock_receipt: true_qty must be in [0, %)', v_current_qty using errcode = 'P0001';
  end if;
  v_removed_qty := v_current_qty - p_true_qty;

  -- 7. Removal amounts (VAT-residual; unit_cost is NET).
  v_removed_net   := round(v_removed_qty * v_unit_cost, 2);
  v_removed_vat   := case when v_vat_rate > 0 then round(v_removed_net * v_vat_rate / 100, 2) else 0 end;
  v_removed_gross := v_removed_net + v_removed_vat;

  -- 8. Floors + cumulative caps (belt-and-suspenders under the lock).
  if v_on_hand < v_removed_qty then
    raise exception 'correct_stock_receipt: on-hand below removal qty' using errcode = '22023';
  end if;
  if v_value - v_removed_net < 0 then
    raise exception 'correct_stock_receipt: on-hand value below removal net' using errcode = '22023';
  end if;
  if v_cum_qty + v_removed_qty > v_qty then
    raise exception 'correct_stock_receipt: cumulative removed qty exceeds booked' using errcode = 'P0001';
  end if;
  if v_cum_net + v_removed_net > v_total_cost then
    raise exception 'correct_stock_receipt: cumulative removed net exceeds booked cost' using errcode = 'P0001';
  end if;

  -- 9. Record the correction; decrement the pool by the identical removed_net.
  insert into public.stock_receipt_corrections
    (receipt_id, request_id, removed_qty, removed_net, removed_vat, removed_gross,
     true_qty, reason, supplier_id, corrected_by)
  values
    (p_receipt_id, p_request_id, v_removed_qty, v_removed_net, v_removed_vat, v_removed_gross,
     p_true_qty, v_reason, v_supplier, auth.uid())
  returning id into v_id;

  update public.stock_on_hand
     set qty_on_hand = v_on_hand - v_removed_qty,
         total_value = v_value - v_removed_net,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  -- 10. If applied from a flag, close it (lock + re-assert pending — mirror
  --     decide_identity_change) so a double-apply of one flag is safe.
  if p_request_id is not null then
    perform 1 from public.receipt_correction_requests where id = p_request_id for update;
    if not exists (select 1 from public.receipt_correction_requests where id = p_request_id and status = 'pending') then
      raise exception 'correct_stock_receipt: flag is not pending' using errcode = 'P0001';
    end if;
    update public.receipt_correction_requests
       set status = 'applied', decided_by = auth.uid(), decided_at = now(), correction_id = v_id
     where id = p_request_id;
  end if;

  -- 11. Audit (closes the gap where stock reversals write none).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), v_role, 'stock_receipt_correction', 'stock_receipts', p_receipt_id,
     jsonb_build_object('ordered', v_qty, 'true_qty', p_true_qty,
                        'removed_qty', v_removed_qty, 'removed_net', v_removed_net,
                        'removed_vat', v_removed_vat, 'removed_gross', v_removed_gross,
                        'reason', v_reason, 'request_id', p_request_id));

  return v_id;
end;
$$;
revoke all on function public.correct_stock_receipt(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.correct_stock_receipt(uuid, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reverse_stock_receipt — LIVE body (2026-07-16) + the mutual guard (a) and the
-- dangling-flag auto-resolver (b). Body otherwise verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_stock_receipt(p_receipt_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'reverse_stock_receipt: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_receipts where id = p_receipt_id;
  if v_project is null then
    raise exception 'reverse_stock_receipt: unknown receipt' using errcode = '22023';
  end if;
  if not (public.can_see_project(v_project) or v_role in ('procurement', 'procurement_manager')) then
    raise exception 'reverse_stock_receipt: not a project member' using errcode = '42501';
  end if;

  -- (a) Spec 324 mutual guard: a partially-corrected receipt is not reversible
  --     (the two paths would double-remove the same receipt).
  if exists (select 1 from public.stock_receipt_corrections where receipt_id = p_receipt_id) then
    raise exception 'reverse_stock_receipt: receipt already corrected, cannot reverse' using errcode = 'P0001';
  end if;

  insert into public.stock_reversals (project_id, catalog_item_id, receipt_id, qty, value_delta, note)
  values (v_project, v_item, p_receipt_id, v_qty, -v_total_cost, v_note)
  returning id into v_id;

  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null or v_on_hand < v_qty then
    raise exception 'reverse_stock_receipt: stock already moved, cannot reverse'
      using errcode = '22023';
  end if;

  update public.stock_on_hand
     set qty_on_hand = v_on_hand - v_qty,
         total_value = case when v_on_hand - v_qty = 0 then 0 else v_value - v_total_cost end,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  -- (b) Spec 324: a full reversal makes any pending correction flag moot.
  update public.receipt_correction_requests
     set status = 'obsolete', decided_by = auth.uid(), decided_at = now()
   where receipt_id = p_receipt_id and status = 'pending';

  return v_id;
end;
$$;
