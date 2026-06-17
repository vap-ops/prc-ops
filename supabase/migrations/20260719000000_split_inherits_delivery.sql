-- Spec 135 U2 / ADR 0054 §7 — a within-ticket split keeps the remainder in the SAME
-- delivery as the line it split from. U1 added purchase_requests.delivery_id but left
-- the split RPC untouched, so its child was inserted with delivery_id NULL — an orphan
-- (no delivery → dropped from the การจัดส่ง view + violates "every PO member has a
-- delivery"). Fix: the child inherits v_orig.delivery_id. Body = the 20260717000000
-- version verbatim + that one column on the child insert; same signature.

create or replace function public.split_purchase_request_on_receipt(
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
       not in ('site_admin', 'project_manager', 'super_admin') then
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

  if v_orig.purchase_order_id is null
     or v_orig.status not in ('purchased', 'on_route') then
    raise exception
      'split_purchase_request_on_receipt: not an in-transit PO member (status %)', v_orig.status
      using errcode = 'P0001';
  end if;

  if p_received_qty is null or p_received_qty <= 0 or p_received_qty >= v_orig.quantity then
    raise exception
      'split_purchase_request_on_receipt: received qty must be > 0 and < ordered (%)', v_orig.quantity
      using errcode = 'P0001';
  end if;

  v_remaining_qty := v_orig.quantity - p_received_qty;

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

  -- The remainder child stays in the SAME delivery as the original (ADR 0054 §7).
  insert into public.purchase_requests (
    work_package_id, item_description, quantity, unit, status, source,
    requested_by, requested_by_email, approved_by, decided_at, decision_comment,
    supplier, supplier_id, order_ref, amount, purchased_at, shipped_at,
    eta, needed_by, priority, notes, purchase_order_id, delivery_id, split_from_request_id
  )
  values (
    v_orig.work_package_id, v_orig.item_description, v_remaining_qty, v_orig.unit,
    'on_route', v_orig.source,
    v_orig.requested_by, v_orig.requested_by_email, v_orig.approved_by, v_orig.decided_at,
    v_orig.decision_comment, v_orig.supplier, v_orig.supplier_id, v_orig.order_ref,
    v_remaining_amt, v_orig.purchased_at, coalesce(v_orig.shipped_at, now()),
    v_orig.eta, v_orig.needed_by, v_orig.priority, v_orig.notes,
    v_orig.purchase_order_id, v_orig.delivery_id, p_request_id
  )
  returning id into v_child_id;

  update public.purchase_requests
     set quantity         = p_received_qty,
         amount           = v_delivered_amt,
         delivered_at     = now(),
         received_by      = p_received_by,
         delivery_note    = p_delivery_note,
         delivery_batch_id = gen_random_uuid()
   where id = p_request_id;

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
