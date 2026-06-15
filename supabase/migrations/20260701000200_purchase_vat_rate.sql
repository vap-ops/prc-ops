-- Spec 119 / ADR 0045 — capture VAT on a purchase.
--
-- amount stays canonically the GROSS (total incl VAT = what you pay; spend /
-- budget / PO total read gross, unchanged — operator decision). The new
-- vat_rate records the rate applied (0 = no VAT recorded; legacy rows default 0).
-- net / VAT are DERIVED for display (src/lib/purchasing/vat.ts deriveVatBreakdown)
-- — not stored, no drift to maintain.
--
-- vat_rate posture = amount's: written ONLY by the purchase RPCs (it is NOT in
-- the authenticated column-scoped UPDATE grant of 20260616000400, so app sessions
-- can't set it directly); table-level SELECT already covers reads, gated to
-- procurement/admin at the app layer like amount. No new grant.

alter table public.purchase_requests
  add column vat_rate numeric(5,2) not null default 0,
  add constraint pr_vat_rate_range check (vat_rate >= 0 and vat_rate <= 100);

-- The three amount-entry RPCs each gain p_vat_rate (default 0 = no VAT, so
-- existing callers / tests / appsheet are unaffected). CREATE OR REPLACE cannot
-- add a param → DROP+CREATE, reproducing the CURRENT body verbatim + the rate,
-- then RE-GRANT (the grant drops with the function).

-- 1. record_purchase (+p_vat_rate). Body = 20260616000300 (coalesce-preserve).
drop function if exists public.record_purchase(uuid, uuid, text, numeric, date);
create function public.record_purchase(
  p_purchase_request_id uuid,
  p_supplier_id uuid,
  p_order_ref text default null,
  p_amount numeric default null,
  p_eta date default null,
  p_vat_rate numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier_name text;
  v_order_ref text := nullif(trim(coalesce(p_order_ref, '')), '');
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin') then
    raise exception 'record_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_purchase: amount must be positive'
      using errcode = 'P0001';
  end if;

  if v_order_ref is not null and length(v_order_ref) > 80 then
    raise exception 'record_purchase: order_ref longer than 80 characters'
      using errcode = 'P0001';
  end if;

  select s.name into v_supplier_name
    from public.suppliers s
   where s.id = p_supplier_id;
  if v_supplier_name is null then
    raise exception 'record_purchase: supplier not found'
      using errcode = 'P0001';
  end if;

  update public.purchase_requests
     set supplier     = v_supplier_name,
         supplier_id  = p_supplier_id,
         order_ref    = coalesce(v_order_ref, order_ref),
         amount       = coalesce(p_amount, amount),
         eta          = coalesce(p_eta, eta),
         vat_rate     = p_vat_rate,
         purchased_at = now()
   where id = p_purchase_request_id
     and status = 'approved'
     and purchased_at is null;
  if not found then
    raise exception 'record_purchase: request is not in a recordable state'
      using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.record_purchase(uuid, uuid, text, numeric, date, numeric)
  from public, anon;
grant execute on function public.record_purchase(uuid, uuid, text, numeric, date, numeric)
  to authenticated;

-- 2. create_purchase_order (+p_vat_rate, one rate for the whole PO — a PO is one
--    supplier). Body = 20260701000100 + per-line vat_rate + the rate in the audit.
drop function if exists public.create_purchase_order(uuid, date, jsonb);
create function public.create_purchase_order(
  p_supplier_id uuid,
  p_eta date,
  p_lines jsonb,
  p_vat_rate numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier_name text;
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
       'line_count',  jsonb_array_length(p_lines),
       'request_ids', to_jsonb(v_request_ids)
     ));

  return v_po_id;
end;
$$;
revoke all on function public.create_purchase_order(uuid, date, jsonb, numeric)
  from public, anon;
grant execute on function public.create_purchase_order(uuid, date, jsonb, numeric)
  to authenticated;

-- 3. record_site_purchase (+p_vat_rate). Body = 20260630000100 + amount's VAT.
drop function if exists public.record_site_purchase(uuid, text, numeric, text, numeric);
create function public.record_site_purchase(
  p_work_package_id uuid,
  p_item_description text,
  p_quantity numeric,
  p_unit text,
  p_amount numeric default null,
  p_vat_rate numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'record_site_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if v_item is null then
    raise exception 'record_site_purchase: item description required'
      using errcode = 'P0001';
  end if;
  if length(v_item) > 500 then
    raise exception 'record_site_purchase: item description too long'
      using errcode = 'P0001';
  end if;
  if v_unit is null then
    raise exception 'record_site_purchase: unit required'
      using errcode = 'P0001';
  end if;
  if length(v_unit) > 40 then
    raise exception 'record_site_purchase: unit too long'
      using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'record_site_purchase: quantity must be positive'
      using errcode = 'P0001';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_site_purchase: amount must be positive'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.work_packages wp where wp.id = p_work_package_id) then
    raise exception 'record_site_purchase: work package not found'
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit, amount, vat_rate,
     status, source, requested_by, purchased_at, delivered_at, received_by, received_by_id)
  values
    (p_work_package_id, v_item, p_quantity, v_unit, p_amount, p_vat_rate,
     'site_purchased', 'site_purchase', auth.uid(), now(), now(), v_actor, auth.uid())
  returning id into v_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'insert',
     'purchase_requests',
     v_id,
     jsonb_build_object(
       'source',           'site_purchase',
       'work_package_id',  p_work_package_id,
       'item_description', v_item,
       'quantity',         p_quantity,
       'unit',             v_unit,
       'amount',           p_amount,
       'vat_rate',         p_vat_rate,
       'received_by',      v_actor
     ));

  return v_id;
end;
$$;
revoke all on function public.record_site_purchase(uuid, text, numeric, text, numeric, numeric)
  from public, anon;
grant execute on function public.record_site_purchase(uuid, text, numeric, text, numeric, numeric)
  to authenticated;
