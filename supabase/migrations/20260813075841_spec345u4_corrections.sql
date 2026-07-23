-- Spec 345 U4 — corrections (danger-path: money RPC gates).
--
-- The accounting role runs the money-event review queue but, at HEAD, cannot
-- CORRECT any of the money events it reviews. This unit opens the correction
-- paths per spec D4:
--
--   • Widen five existing money-correction RPCs to include `accounting`:
--       - correct_stock_receipt / decide_receipt_correction_request (spec 324):
--         role gate is_back_office -> is_back_office OR accounting, AND the
--         membership exemption gains accounting. Both edits are required because
--         can_see_project(accounting) is false — the role gate alone would let
--         accounting past the first check only to be refused by the membership
--         check as a non-member of the receipt's project.
--       - supersede_client_receipt / supersede_subcontract_payment:
--         is_manager -> is_manager OR accounting.
--       - supersede_rental_settlement: accounting added to the explicit list.
--     (Each widened body is reproduced verbatim from its live definition with
--      ONLY the gate predicate changed — CREATE OR REPLACE preserves grants.)
--
--   • Create two new gated correction RPCs (append-only / plain-UPDATE, GL and
--     U1's stale-verify trigger self-heal off the write):
--       - supersede_wage_payment  (there was NO wage supersede writer; the
--         superseded_by column + dc_payments_reason_iff_supersede CHECK were
--         waiting for one). Gated is_back_office+accounting. The wage GL enqueue
--         is unconditional AFTER INSERT and the poster is supersede-aware, so the
--         correction always reposts.
--       - correct_office_expense  (accounting+super, mirrors mark_expense_reimbursed;
--         plain UPDATE amount+expense_date). Office expenses have no GL poster and
--         no edit RPC at HEAD (record_office_expense inserts, mark_expense_reimbursed
--         reimburses) — this answers open item 3.
--
--   • DEFERRED — correct_purchase_amount. The plan premised it on "plain UPDATE,
--     the GL enqueue trigger reverse-and-reposts on amount change". That trigger
--     fires only WHEN work_package_id IS NOT NULL AND status IN (purchased,
--     site_purchased) — but 100% of live purchase money events are store-first
--     (work_package_id force-nulled, ADR 0065): 481 delivered + 2 purchased + 1
--     cancelled, ALL wp-null (probed 2026-07-23). Their money is booked as
--     INVENTORY at receipt off the stock_receipt (unit_cost), not off this row, so
--     a plain PR.amount UPDATE would never repost GL — it would only make the
--     displayed amount disagree with the inventory it created. Correcting a
--     store-first purchase's price belongs in the stock/inventory layer and needs
--     its own design; until then purchases are flag-only here. 🔔 operator call.
--
--   • client_billings + wht_certificates + purchase_requests stay flag-only (no
--     correction RPC — client-facing paper re-certified/re-recorded by PM per D4;
--     purchases deferred per the note above).
--
-- Every new correction audits action='other' + payload->>'event'='money_review_corrected'
-- (the lane-344 audit convention, no new audit_action enum value). Notifying the
-- origin is deferred to U5, which owns the money-doc notification events; the
-- existing supersede RPCs never notified either, and U1's stale-verify trigger is
-- already the live signal that flips a verified review back to pending on any
-- correction.

-- ── supersede_wage_payment (new) ────────────────────────────────────────────
create or replace function public.supersede_wage_payment(
  p_payment_id uuid, p_paid_amount numeric, p_paid_at date,
  p_method public.wage_payment_method, p_reference text, p_note text, p_correction_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_reason text := nullif(btrim(coalesce(p_correction_reason, '')), '');
  v_target public.wage_payments%rowtype;
  v_id     uuid;
begin
  -- Money: mirror record_wage_payment's back-office gate, widened to accounting (U4).
  if v_role is null or not (public.is_back_office(v_role) or v_role = 'accounting') then
    raise exception 'supersede_wage_payment: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'supersede_wage_payment: correction_reason required' using errcode = 'P0001';
  end if;
  if p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'supersede_wage_payment: paid_amount must be >= 0' using errcode = 'P0001';
  end if;
  if p_paid_at is null or p_method is null then
    raise exception 'supersede_wage_payment: paid_at and method required' using errcode = 'P0001';
  end if;

  -- FOR UPDATE serializes concurrent corrections of the same payment: the second
  -- caller blocks on the target row, then its already-superseded check sees the
  -- first caller's superseding row and refuses — no double-supersede / double-post.
  select * into v_target from public.wage_payments where id = p_payment_id for update;
  if not found then
    raise exception 'supersede_wage_payment: payment not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.wage_payments n where n.superseded_by = p_payment_id) then
    raise exception 'supersede_wage_payment: payment already superseded' using errcode = 'P0001';
  end if;

  -- Append-only correction: a NEW row carrying superseded_by + correction_reason
  -- (dc_payments_reason_iff_supersede). computed_* are the payroll snapshot at
  -- record time — carried from the target, not recomputed (the correction fixes
  -- the PAID side). The AFTER-INSERT GL enqueue reposts and U1's stale-verify
  -- trigger (keyed on superseded_by) flips the original's review to pending.
  insert into public.wage_payments (
    worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, reference, note, paid_by, superseded_by, correction_reason)
  values (
    v_target.worker_id, v_target.period_from, v_target.period_to,
    v_target.computed_amount, v_target.computed_days,
    p_paid_amount, p_paid_at, p_method,
    nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid(), p_payment_id, v_reason)
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), v_role, 'wage_payments', v_id,
    jsonb_build_object('event', 'money_review_corrected', 'source_table', 'wage_payments',
                       'superseded', p_payment_id, 'paid_amount', p_paid_amount,
                       'method', p_method, 'correction_reason', v_reason));
  return v_id;
end;
$function$;

revoke all on function public.supersede_wage_payment(uuid, numeric, date, public.wage_payment_method, text, text, text) from public, anon;
grant execute on function public.supersede_wage_payment(uuid, numeric, date, public.wage_payment_method, text, text, text) to authenticated;

-- ── correct_office_expense (new) ────────────────────────────────────────────
create or replace function public.correct_office_expense(
  p_expense_id uuid, p_amount numeric, p_expense_date date, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Accounting audit correction — same gate as mark_expense_reimbursed.
  if v_role is null or v_role not in ('accounting', 'super_admin') then
    raise exception 'correct_office_expense: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'correct_office_expense: reason required' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'correct_office_expense: amount must be positive' using errcode = 'P0001';
  end if;
  if p_expense_date is null then
    raise exception 'correct_office_expense: expense_date required' using errcode = 'P0001';
  end if;

  -- Plain UPDATE (office_expenses is in-place updatable; only U1's stale-verify
  -- trigger reacts — there is no office-expense GL poster).
  update public.office_expenses
     set amount = p_amount, expense_date = p_expense_date
   where id = p_expense_id;
  if not found then
    raise exception 'correct_office_expense: expense not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), v_role, 'office_expenses', p_expense_id,
    jsonb_build_object('event', 'money_review_corrected', 'source_table', 'office_expenses',
                       'amount', p_amount, 'expense_date', p_expense_date, 'reason', v_reason));
  return p_expense_id;
end;
$function$;

revoke all on function public.correct_office_expense(uuid, numeric, date, text) from public, anon;
grant execute on function public.correct_office_expense(uuid, numeric, date, text) to authenticated;

-- ── Widen correct_stock_receipt (role gate + membership exemption) ──────────
-- Verbatim from the live definition; ONLY the two gate predicates gain accounting.
create or replace function public.correct_stock_receipt(p_receipt_id uuid, p_true_qty numeric, p_reason text, p_request_id uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- 1. Role gate (null-safe, back-office + accounting) + reason.
  if v_role is null or not (public.is_back_office(v_role) or v_role = 'accounting') then
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
  --     can see; procurement / procurement_manager / accounting (and the see-all
  --     tiers via can_see_project) are cross-project by design.
  if not (public.can_see_project(v_project) or v_role in ('procurement', 'procurement_manager', 'accounting')) then
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
$function$;

-- ── Widen decide_receipt_correction_request (role gate + membership exemption) ──
create or replace function public.decide_receipt_correction_request(p_request_id uuid, p_approve boolean, p_true_qty numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role       public.user_role := public.current_user_role();
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_req        public.receipt_correction_requests%rowtype;
  v_project    uuid;
  v_correction uuid;
begin
  if v_role is null or not (public.is_back_office(v_role) or v_role = 'accounting') then
    raise exception 'decide_receipt_correction_request: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.receipt_correction_requests where id = p_request_id for update;
  if not found then
    raise exception 'decide_receipt_correction_request: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_receipt_correction_request: request already decided' using errcode = 'P0001';
  end if;

  -- Membership scope PARITY with the approve path (correct_stock_receipt gates the
  -- same way): a non-member project_manager must not reject — and thereby
  -- reject-CLOSE — a flag on a project it has no authority over. Applies to BOTH
  -- branches (harmless-redundant on approve, where correct_stock_receipt re-checks).
  select project_id into v_project from public.stock_receipts where id = v_req.receipt_id;
  if not (public.can_see_project(v_project) or v_role in ('procurement', 'procurement_manager', 'accounting')) then
    raise exception 'decide_receipt_correction_request: not a project member' using errcode = '42501';
  end if;

  if p_approve then
    if p_true_qty is null then
      raise exception 'decide_receipt_correction_request: true_qty required to approve' using errcode = 'P0001';
    end if;
    -- correct_stock_receipt applies its own back-office + fresh-pool gates, sets
    -- the flag to 'applied', and links the correction id.
    v_correction := public.correct_stock_receipt(
      v_req.receipt_id, p_true_qty, coalesce(v_note, v_req.reason), p_request_id);
    return v_correction;
  else
    if v_note is null then
      raise exception 'decide_receipt_correction_request: a note is required to reject' using errcode = 'P0001';
    end if;
    update public.receipt_correction_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = p_request_id;
    return p_request_id;
  end if;
end;
$function$;

-- ── Widen supersede_client_receipt (is_manager OR accounting) ───────────────
create or replace function public.supersede_client_receipt(p_receipt_id uuid, p_amount numeric, p_received_date date, p_method receipt_method, p_billing_id uuid, p_note text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_target      public.client_receipts;
  v_id          uuid;
begin
  if not (public.is_manager(public.current_user_role()) or public.current_user_role() = 'accounting') then
    raise exception 'supersede_client_receipt: role not permitted' using errcode = '42501';
  end if;

  select * into v_target from public.client_receipts where id = p_receipt_id;
  if not found then
    raise exception 'supersede_client_receipt: receipt not found' using errcode = 'P0001';
  end if;
  if v_target.amount is null then
    raise exception 'supersede_client_receipt: cannot supersede a tombstone' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.client_receipts n where n.superseded_by = p_receipt_id) then
    raise exception 'supersede_client_receipt: receipt already superseded' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_received_date is null or p_method is null) then
    raise exception 'supersede_client_receipt: replacement needs amount > 0, date and method' using errcode = 'P0001';
  end if;

  insert into public.client_receipts
    (project_id, client_billing_id, amount, received_date, method, note, created_by, superseded_by)
  values
    (v_target.project_id,
     case when p_amount is null then null else p_billing_id end,
     p_amount,
     case when p_amount is null then null else p_received_date end,
     case when p_amount is null then null else p_method end,
     nullif(btrim(coalesce(p_note,'')),''),
     auth.uid(),
     p_receipt_id)
  returning id into v_id;

  -- Both sides can change coverage: the billing the old row fed and the one the
  -- replacement feeds.
  perform public.recompute_billing_receipt_status(v_target.client_billing_id);
  if p_amount is not null and p_billing_id is distinct from v_target.client_billing_id then
    perform public.recompute_billing_receipt_status(p_billing_id);
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_receipt_supersede', auth.uid(), public.current_user_role(), 'client_receipts', v_id,
          jsonb_build_object('superseded', p_receipt_id, 'amount', p_amount,
                             'billing_id', p_billing_id));
  return v_id;
end;
$function$;

-- ── Widen supersede_rental_settlement (accounting added to the list) ────────
create or replace function public.supersede_rental_settlement(p_settlement_id uuid, p_invoice_no text, p_invoice_date date, p_base numeric, p_overtime numeric, p_fees numeric, p_vat numeric, p_deposit_refunded numeric, p_deposit_forfeited numeric, p_method receipt_method, p_correction_reason text, p_note text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_target      public.rental_settlements%rowtype;
  v_deposit_cap numeric(12, 2);
  v_is_vat      boolean;
  v_base        numeric(12, 2) := coalesce(p_base, 0);
  v_overtime    numeric(12, 2) := coalesce(p_overtime, 0);
  v_fees        numeric(12, 2) := coalesce(p_fees, 0);
  v_vat         numeric(12, 2);
  v_refunded    numeric(12, 2) := coalesce(p_deposit_refunded, 0);
  v_forfeited   numeric(12, 2) := coalesce(p_deposit_forfeited, 0);
  v_net         numeric(12, 2);
  v_id          uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement',
             'procurement_manager', 'project_director', 'accounting') then
    raise exception 'supersede_rental_settlement: role not permitted' using errcode = '42501';
  end if;

  select * into v_target from public.rental_settlements where id = p_settlement_id;
  if not found then
    raise exception 'supersede_rental_settlement: settlement not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.rental_settlements n where n.superseded_by = p_settlement_id) then
    raise exception 'supersede_rental_settlement: settlement already superseded' using errcode = 'P0001';
  end if;
  if p_invoice_date is null or p_method is null then
    raise exception 'supersede_rental_settlement: invoice date and method required' using errcode = 'P0001';
  end if;
  if p_correction_reason is null or btrim(p_correction_reason) = '' then
    raise exception 'supersede_rental_settlement: correction_reason required' using errcode = 'P0001';
  end if;

  select deposit_amount into v_deposit_cap
    from public.equipment_rental_batches where id = v_target.agreement_id;
  if v_refunded + v_forfeited > coalesce(v_deposit_cap, 0) then
    raise exception 'supersede_rental_settlement: deposit refunded+forfeited exceeds the agreement deposit'
      using errcode = 'P0001';
  end if;

  select coalesce(is_vat_registered, false) into v_is_vat
    from public.suppliers s
    join public.equipment_rental_batches b on b.supplier_id = s.id
   where b.id = v_target.agreement_id;
  v_vat := case when coalesce(v_is_vat, false) then coalesce(p_vat, 0) else 0 end;
  v_net := v_base + v_overtime + v_fees;

  insert into public.rental_settlements
    (agreement_id, invoice_no, invoice_date, base_amount, overtime_amount, fees_amount,
     net_amount, vat_amount, wht_amount, deposit_refunded, deposit_forfeited, method, note,
     created_by, superseded_by, correction_reason)
  values
    (v_target.agreement_id, btrim(coalesce(p_invoice_no, '')), p_invoice_date, v_base, v_overtime, v_fees,
     v_net, v_vat, v_target.wht_amount, v_refunded, v_forfeited, p_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_settlement_id, btrim(p_correction_reason))
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'rental_settlement_supersede', 'rental_settlements', v_id,
          jsonb_build_object('superseded', p_settlement_id, 'net_amount', v_net,
                             'correction_reason', btrim(p_correction_reason)));
  return v_id;
end;
$function$;

-- ── Widen supersede_subcontract_payment (is_manager OR accounting) ──────────
create or replace function public.supersede_subcontract_payment(p_payment_id uuid, p_kind subcontract_payment_kind, p_amount numeric, p_paid_date date, p_method receipt_method, p_note text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_target public.subcontract_payments;
  v_id     uuid;
begin
  if not (public.is_manager(public.current_user_role()) or public.current_user_role() = 'accounting') then
    raise exception 'supersede_subcontract_payment: role not permitted' using errcode = '42501';
  end if;

  select * into v_target from public.subcontract_payments where id = p_payment_id;
  if not found then
    raise exception 'supersede_subcontract_payment: payment not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.subcontract_payments n where n.superseded_by = p_payment_id) then
    raise exception 'supersede_subcontract_payment: payment already superseded' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'supersede_subcontract_payment: amount must be > 0' using errcode = 'P0001';
  end if;
  if p_paid_date is null or p_method is null or p_kind is null then
    raise exception 'supersede_subcontract_payment: kind, date and method required' using errcode = 'P0001';
  end if;

  insert into public.subcontract_payments
    (subcontract_id, kind, amount, paid_date, method, note, created_by, superseded_by)
  values
    (v_target.subcontract_id, p_kind, p_amount, p_paid_date, p_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_payment_id)
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_payment_supersede', auth.uid(), public.current_user_role(), 'subcontract_payments', v_id,
          jsonb_build_object('superseded', p_payment_id, 'kind', p_kind, 'amount', p_amount));
  return v_id;
end;
$function$;
