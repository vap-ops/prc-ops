-- Spec 134 U5 / ADR 0053 — explicit PO-level receive.
--
-- The common delivery cases (whole PO, or a whole-ticket subset waiting on restock)
-- should mark lines delivered in ONE action, not a photo per ticket. This RPC sets
-- the delivery facts on the chosen in-transit members; the EXISTING derive trigger
-- advances purchased|on_route → delivered and the audit trigger writes the standard
-- per-line `purchase_request_delivery` row. No new column, no change to the spec-24
-- photo path (which stays for ad-hoc single-ticket receipt) or the roll-up.

create function public.receive_po_lines(
  p_request_ids uuid[],
  p_received_by text default null,
  p_delivery_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'procurement', 'super_admin') then
    raise exception 'receive_po_lines: role not permitted' using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'receive_po_lines: no lines' using errcode = 'P0001';
  end if;

  -- All-or-nothing: each id must be an in-transit member. Setting delivered_at
  -- drives the derive trigger to 'delivered' and the audit trigger to log it; the
  -- status filter also blocks double-receiving an already-delivered line.
  foreach v_id in array p_request_ids loop
    update public.purchase_requests
       set delivered_at  = now(),
           received_by   = p_received_by,
           delivery_note = p_delivery_note
     where id = v_id
       and status in ('purchased', 'on_route');
    if not found then
      raise exception 'receive_po_lines: line % is not an in-transit member', v_id
        using errcode = 'P0001';
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.receive_po_lines(uuid[], text, text) from public, anon;
grant execute on function public.receive_po_lines(uuid[], text, text) to authenticated;
