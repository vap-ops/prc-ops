-- Spec 134 U3 / ADR 0052 — within-ticket partial delivery via split-on-receipt.
--
-- When a ticket's quantity arrives in parts (ordered 100, 50 now), split it into a
-- DELIVERED portion (the original row, reduced) + a REMAINING portion (a new child,
-- on_route), both members of the same PO. The across-ticket roll-up
-- (derivePurchaseOrderStatus) + spec 134 U1/U2 then render `partially_received`
-- from ordinary member statuses with no new derive/display logic (ADR 0052 §1).
--
-- Status comes from the EXISTING derive trigger, not a direct write: the original's
-- delivered_at write advances purchased|on_route → delivered and the audit trigger
-- logs the delivery (purchase_requests_audit_appsheet Case 2). The child is INSERTed
-- directly at on_route (no INSERT-side derive trigger fires). This function adds ONE
-- extra audit row capturing the split shape (action 'update', the ADR 0027/0031
-- no-new-audit_action-value precedent).

-- 1. Lineage column (ADR 0052 §2). A child points at the row it was split from; a
--    line's original ordered quantity = the sum over its split family. NOT named in
--    the authenticated column-scoped UPDATE grant (20260616000400), so only the RPC
--    below (function owner) can write it — the ADR 0038 fact-column posture, for
--    free.
alter table public.purchase_requests
  add column split_from_request_id uuid null references public.purchase_requests(id);

create index purchase_requests_split_from_request_id_idx
  on public.purchase_requests (split_from_request_id);

-- 2. The split RPC (ADR 0052 §5). Authenticated session (so auth.uid() is non-null —
--    the spec-68 / ADR 0044 §4 lesson), back-office gate.
create function public.split_purchase_request_on_receipt(
  p_request_id uuid,
  p_received_qty numeric,
  p_received_by text default null,
  p_delivery_note text default null,
  p_delivered_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig          public.purchase_requests%rowtype;
  v_remaining_qty numeric;
  v_delivered_amt numeric;
  v_remaining_amt numeric;
  v_child_id      uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'procurement', 'super_admin') then
    raise exception 'split_purchase_request_on_receipt: role not permitted'
      using errcode = '42501';
  end if;

  select * into v_orig
    from public.purchase_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception 'split_purchase_request_on_receipt: request not found'
      using errcode = 'P0001';
  end if;

  -- Must be an in-transit member of a PO (a one-off or a not-yet-ordered ticket
  -- can't be partially received against an order).
  if v_orig.purchase_order_id is null
     or v_orig.status not in ('purchased', 'on_route') then
    raise exception
      'split_purchase_request_on_receipt: not an in-transit PO member (status %)', v_orig.status
      using errcode = 'P0001';
  end if;

  -- Quantity guard: strictly partial. Equal-or-greater is a FULL delivery — use the
  -- existing delivery/photo path, not a split.
  if p_received_qty is null or p_received_qty <= 0 or p_received_qty >= v_orig.quantity then
    raise exception
      'split_purchase_request_on_receipt: received qty must be > 0 and < ordered (%)', v_orig.quantity
      using errcode = 'P0001';
  end if;

  v_remaining_qty := v_orig.quantity - p_received_qty;

  -- Amount split (ADR 0052 §4): proportional default, buyer-editable; the family sum
  -- equals the original exactly (no drift). An unpriced line stays unpriced.
  if v_orig.amount is null then
    v_delivered_amt := null;
    v_remaining_amt := null;
  elsif p_delivered_amount is not null then
    if p_delivered_amount < 0 or p_delivered_amount > v_orig.amount then
      raise exception
        'split_purchase_request_on_receipt: delivered amount out of range (0..%)', v_orig.amount
        using errcode = 'P0001';
    end if;
    v_delivered_amt := p_delivered_amount;
    v_remaining_amt := v_orig.amount - p_delivered_amount;
  else
    v_delivered_amt := round(v_orig.amount * p_received_qty / v_orig.quantity, 2);
    v_remaining_amt := v_orig.amount - v_delivered_amt;
  end if;

  -- The remaining portion: a new child, on_route, same order. pr_number is the
  -- sequence default; shipped_at is set so on_route is honest (a partial arrival
  -- implies the order shipped).
  insert into public.purchase_requests (
    work_package_id, item_description, quantity, unit, status, source,
    requested_by, requested_by_email, approved_by, decided_at, decision_comment,
    supplier, supplier_id, order_ref, amount, purchased_at, shipped_at,
    eta, needed_by, priority, notes, purchase_order_id, split_from_request_id
  )
  values (
    v_orig.work_package_id, v_orig.item_description, v_remaining_qty, v_orig.unit,
    'on_route', v_orig.source,
    v_orig.requested_by, v_orig.requested_by_email, v_orig.approved_by, v_orig.decided_at,
    v_orig.decision_comment, v_orig.supplier, v_orig.supplier_id, v_orig.order_ref,
    v_remaining_amt, v_orig.purchased_at, coalesce(v_orig.shipped_at, now()),
    v_orig.eta, v_orig.needed_by, v_orig.priority, v_orig.notes,
    v_orig.purchase_order_id, p_request_id
  )
  returning id into v_child_id;

  -- The delivered portion: reduce the ORIGINAL and set delivered_at — the derive
  -- trigger advances purchased|on_route → delivered, the audit trigger logs it.
  update public.purchase_requests
     set quantity      = p_received_qty,
         amount        = v_delivered_amt,
         delivered_at  = now(),
         received_by   = p_received_by,
         delivery_note = p_delivery_note
   where id = p_request_id;

  -- One audit row for the split shape (action 'update', ADR 0027/0031 precedent —
  -- no new audit_action enum value). Real actor on the authenticated session.
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(), 'update', 'purchase_requests', p_request_id,
     jsonb_build_object(
       'principal',         session_user,
       'transition',        jsonb_build_array('partial_receipt_split'),
       'split_child_id',    v_child_id,
       'ordered_qty',       v_orig.quantity,
       'received_qty',      p_received_qty,
       'remaining_qty',     v_remaining_qty,
       'delivered_amount',  v_delivered_amt,
       'remaining_amount',  v_remaining_amt,
       'purchase_order_id', v_orig.purchase_order_id
     ));

  return v_child_id;
end;
$$;

revoke all on function
  public.split_purchase_request_on_receipt(uuid, numeric, text, text, numeric)
  from public, anon;
grant execute on function
  public.split_purchase_request_on_receipt(uuid, numeric, text, text, numeric)
  to authenticated;
