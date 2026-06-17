-- Spec 135 U3 / ADR 0054 — split_purchase_order_delivery. Procurement plans a PO's
-- deliveries (งวดส่ง): move selected IN-TRANSIT member lines into a NEW
-- purchase_order_deliveries row carrying its own eta/note/cost. The default delivery
-- (U1) keeps the 85% one-tap; this is the explicit split for the multi-delivery 15%.
--
-- WRITE POSTURE (ADR 0038): the only writer of purchase_order_deliveries +
-- purchase_requests.delivery_id is a SECURITY DEFINER RPC (create_purchase_order in
-- U1; this one for the split). No direct INSERT/UPDATE policy; the authenticated
-- column-scoped UPDATE grant (20260616000400) does not name delivery_id.
--
-- GATE: back office (project_manager, procurement, super_admin) — NOT site_admin. A
-- delivery is procurement's PLAN, not a receive action (รับของ stays site-only, U8);
-- cost is money (back office). GUARDS: every line is an in-transit member of the PO,
-- and no source delivery is emptied (every PO member keeps a delivery — the U1
-- invariant; deletes are out of scope, ADR 0054).

create function public.split_purchase_order_delivery(
  p_purchase_order_id uuid,
  p_request_ids uuid[],
  p_eta date default null,
  p_note text default null,
  p_cost numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery_id uuid;
  v_count       int;
  v_source      record;
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin') then
    raise exception 'split_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'split_purchase_order_delivery: no lines selected'
      using errcode = 'P0001';
  end if;

  if p_cost is not null and p_cost < 0 then
    raise exception 'split_purchase_order_delivery: cost must be >= 0'
      using errcode = 'P0001';
  end if;

  -- Every selected id must be a distinct in-transit member of THIS PO. A count
  -- mismatch catches a non-member, an already-received (delivered) line, a
  -- rejected/cancelled line, and a duplicate id in one check. Lock the rows so a
  -- concurrent split can't move the same line twice.
  select count(*) into v_count
    from public.purchase_requests
   where id = any(p_request_ids)
     and purchase_order_id = p_purchase_order_id
     and status in ('purchased', 'on_route')
   for update;

  if v_count <> array_length(p_request_ids, 1) then
    raise exception
      'split_purchase_order_delivery: every line must be an in-transit member of the PO'
      using errcode = 'P0001';
  end if;

  -- Non-empty guard: each source delivery the selection draws from must keep >= 1
  -- active (non rejected/cancelled) line after the move. A delivered line counts —
  -- it keeps the delivery alive even when all its in-transit lines move out.
  for v_source in
    select distinct delivery_id
      from public.purchase_requests
     where id = any(p_request_ids)
  loop
    if (select count(*)
          from public.purchase_requests r
         where r.delivery_id = v_source.delivery_id
           and r.status not in ('rejected', 'cancelled')
           and not (r.id = any(p_request_ids))) = 0 then
      raise exception
        'split_purchase_order_delivery: a source delivery cannot be emptied by the split'
        using errcode = 'P0001';
    end if;
  end loop;

  insert into public.purchase_order_deliveries
    (purchase_order_id, eta, note, cost, created_by)
  values
    (p_purchase_order_id, p_eta, nullif(trim(coalesce(p_note, '')), ''), p_cost, auth.uid())
  returning id into v_delivery_id;

  update public.purchase_requests
     set delivery_id = v_delivery_id
   where id = any(p_request_ids);

  -- Audit the split shape (action 'update', the ADR 0027/0031 no-new-enum precedent;
  -- target the new delivery). Real actor on the authenticated session.
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'update', 'purchase_order_deliveries', v_delivery_id,
     jsonb_build_object(
       'principal',         session_user,
       'transition',        jsonb_build_array('delivery_split'),
       'purchase_order_id', p_purchase_order_id,
       'delivery_id',       v_delivery_id,
       'request_ids',       to_jsonb(p_request_ids),
       'line_count',        array_length(p_request_ids, 1),
       'eta',               p_eta,
       'cost',              p_cost
     ));

  return v_delivery_id;
end;
$$;

revoke all on function
  public.split_purchase_order_delivery(uuid, uuid[], date, text, numeric)
  from public, anon;
grant execute on function
  public.split_purchase_order_delivery(uuid, uuid[], date, text, numeric)
  to authenticated;
