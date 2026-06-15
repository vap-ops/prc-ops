-- Spec 120 — unify purchase recording into PO creation. The retired
-- record_purchase form captured the supplier's order/invoice reference
-- (order_ref); the PO flow must carry it so nothing is lost. One order_ref per
-- PO (one supplier order), written onto each member ticket's existing
-- purchase_requests.order_ref column (no new column).
--
-- CREATE OR REPLACE cannot add a param → DROP+CREATE. Body = the 20260701000200
-- (VAT) version verbatim + p_order_ref (validated <= 80, mirrors record_purchase).

drop function if exists public.create_purchase_order(uuid, date, jsonb, numeric);
create function public.create_purchase_order(
  p_supplier_id uuid,
  p_eta date,
  p_lines jsonb,
  p_vat_rate numeric default 0,
  p_order_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier_name text;
  v_order_ref     text := nullif(trim(coalesce(p_order_ref, '')), '');
  v_po_id         uuid;
  v_po_number     bigint;
  v_line          jsonb;
  v_request_id    uuid;
  v_amount        numeric;
  v_request_ids   uuid[] := '{}';
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin') then
    raise exception 'create_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'create_purchase_order: no lines'
      using errcode = 'P0001';
  end if;

  if v_order_ref is not null and length(v_order_ref) > 80 then
    raise exception 'create_purchase_order: order_ref longer than 80 characters'
      using errcode = 'P0001';
  end if;

  select s.name into v_supplier_name
    from public.suppliers s
   where s.id = p_supplier_id;
  if v_supplier_name is null then
    raise exception 'create_purchase_order: supplier not found'
      using errcode = 'P0001';
  end if;

  insert into public.purchase_orders
    (supplier_id, supplier, eta, ordered_at, created_by)
  values
    (p_supplier_id, v_supplier_name, p_eta, now(), auth.uid())
  returning id, po_number into v_po_id, v_po_number;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_request_id := (v_line->>'request_id')::uuid;
    v_amount     := nullif(v_line->>'amount', '')::numeric;

    if v_amount is not null and v_amount <= 0 then
      raise exception 'create_purchase_order: amount must be positive'
        using errcode = 'P0001';
    end if;

    update public.purchase_requests
       set supplier          = v_supplier_name,
           supplier_id       = p_supplier_id,
           amount            = v_amount,
           vat_rate          = p_vat_rate,
           order_ref         = v_order_ref,
           eta               = p_eta,
           purchased_at      = now(),
           status            = 'purchased',
           purchase_order_id = v_po_id
     where id = v_request_id
       and status = 'approved'
       and purchased_at is null;
    if not found then
      raise exception 'create_purchase_order: line % is not an approved request', v_request_id
        using errcode = 'P0001';
    end if;

    v_request_ids := v_request_ids || v_request_id;
  end loop;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'purchase_order_create', 'purchase_orders', v_po_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'supplier',    v_supplier_name,
       'supplier_id', p_supplier_id,
       'eta',         p_eta,
       'vat_rate',    p_vat_rate,
       'order_ref',   v_order_ref,
       'line_count',  jsonb_array_length(p_lines),
       'request_ids', to_jsonb(v_request_ids)
     ));

  return v_po_id;
end;
$$;
revoke all on function public.create_purchase_order(uuid, date, jsonb, numeric, text)
  from public, anon;
grant execute on function public.create_purchase_order(uuid, date, jsonb, numeric, text)
  to authenticated;
