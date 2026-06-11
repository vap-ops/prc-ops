-- Spec 33 / ADR 0038 — in-app purchase/shipment write path.
--
-- Two SECURITY DEFINER RPCs (set_work_package_contractor precedent,
-- ADR 0011 hygiene): role gate + stage guard + input checks inside;
-- each writes exactly the fact set and nothing else. Status flips,
-- audit rows, and notification outbox rows come from the EXISTING
-- trigger chain (derive trigger, fact-audit trigger, spec-32 capture)
-- — this migration adds no trigger. AppSheet's write path is untouched
-- (parallel-path posture, ADR 0034 amendment).

create function public.record_purchase(
  p_purchase_request_id uuid,
  p_supplier_id uuid,
  p_order_ref text default null,
  p_amount numeric default null,
  p_eta date default null
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
         order_ref    = v_order_ref,
         amount       = p_amount,
         eta          = p_eta,
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

create function public.record_shipment(p_purchase_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin') then
    raise exception 'record_shipment: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set shipped_at = now()
   where id = p_purchase_request_id
     and status = 'purchased'
     and shipped_at is null;
  if not found then
    raise exception 'record_shipment: request is not in a shippable state'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.record_purchase(uuid, uuid, text, numeric, date)
  from public, anon;
grant execute on function public.record_purchase(uuid, uuid, text, numeric, date)
  to authenticated;

revoke all on function public.record_shipment(uuid)
  from public, anon;
grant execute on function public.record_shipment(uuid)
  to authenticated;
