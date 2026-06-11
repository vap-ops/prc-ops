-- Spec 33 amendment (adversarial-review finding) — record_purchase must
-- not erase facts AppSheet already wrote on the approved row.
--
-- The original body unconditionally overwrote order_ref/amount/eta with
-- the params, so omitting an optional field NULLed a value the back
-- office may have pre-saved via AppSheet (eta especially — and an eta
-- wipe leaves no audit trace, since the purchase audit payload does not
-- carry eta and the field-correction branch is skipped on a status
-- transition). Optional facts are now set only when provided; clearing a
-- recorded fact remains the corrections seam (AppSheet today, an audited
-- correction RPC later — ADR 0038 consequences).

create or replace function public.record_purchase(
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
         order_ref    = coalesce(v_order_ref, order_ref),
         amount       = coalesce(p_amount, amount),
         eta          = coalesce(p_eta, eta),
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
