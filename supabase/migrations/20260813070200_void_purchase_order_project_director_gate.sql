-- ADR 0058 completeness fix: void_purchase_order (spec 259) was authored after
-- spec 152 U2's project_director sweep and shipped without the role, breaking
-- the "every PM-gated RPC also admits project_director" invariant (caught by
-- 90-project-director-rpc-gates.test.sql on LIVE). Body is the LIVE definition
-- (pg_get_functiondef) with project_director appended to the role check —
-- behaviour-identical otherwise.

CREATE OR REPLACE FUNCTION public.void_purchase_order(p_po_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po_number    bigint;
  v_supplier     text;
  v_request_ids  uuid[];
  v_bad_count    integer;
  v_member       record;
  v_old_entry    uuid;
begin
  -- Back-office gate, identical to create_purchase_order (ADR 0044 §4) — the
  -- same audience that can create a PO can undo their own mistake.
  if public.current_user_role() is null
     or public.current_user_role()
          not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'void_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  select po_number, supplier into v_po_number, v_supplier
    from public.purchase_orders
   where id = p_po_id;
  if v_po_number is null then
    raise exception 'void_purchase_order: purchase order not found'
      using errcode = 'P0001';
  end if;

  -- Revertible only while NOTHING has shipped: every member must still be
  -- exactly at 'purchased' (record_shipment / receive not yet run on any of
  -- them). All-or-nothing — a partially-shipped order needs the per-ticket
  -- paths, not a whole-order undo.
  select count(*) into v_bad_count
    from public.purchase_requests
   where purchase_order_id = p_po_id
     and status <> 'purchased';
  if v_bad_count > 0 then
    raise exception 'void_purchase_order: order has a shipped or received line'
      using errcode = 'P0001';
  end if;

  select array_agg(id) into v_request_ids
    from public.purchase_requests
   where purchase_order_id = p_po_id;

  -- Per member: undo the GL side-effect of its purchase BEFORE unlinking it
  -- (spec 198 U2 pattern) — reverse a posted entry, or skip a pending job.
  for v_member in
    select id from public.purchase_requests where purchase_order_id = p_po_id
  loop
    select e.id into v_old_entry
      from public.journal_entries e
     where e.source_table = 'purchase_requests'
       and e.source_id    = v_member.id
       and e.source_event = 'purchase'
       and e.status       = 'posted'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
     limit 1;
    if v_old_entry is not null then
      perform public.reverse_journal_internal(
        v_old_entry, auth.uid(), 'void: purchase order reverted');
    end if;

    update public.gl_posting_outbox
       set status = 'skipped'
     where source_table = 'purchase_requests'
       and source_id    = v_member.id
       and source_event = 'purchase'
       and status in ('pending', 'posting');
  end loop;

  -- Undo exactly what create_purchase_order stamped — members return to
  -- their pre-purchase shape and are free to be bundled into the correct PO.
  -- vat_rate is NOT NULL (default 0 = "no VAT recorded", spec 119) so it
  -- resets to 0, not null, to match every never-purchased row. needed_by
  -- (the requester's own field) is never touched.
  update public.purchase_requests
     set status            = 'approved',
         purchase_order_id = null,
         delivery_id       = null,
         supplier          = null,
         supplier_id       = null,
         amount            = null,
         vat_rate          = 0,
         order_ref         = null,
         eta               = null,
         purchased_at      = null
   where purchase_order_id = p_po_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'purchase_order_void', 'purchase_orders', p_po_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'supplier',    v_supplier,
       'request_ids', to_jsonb(v_request_ids)
     ));

  -- purchase_order_deliveries cascades on the FK (spec 135 U1); the PO's
  -- po_number is retired, never reused (the running-sequence convention).
  delete from public.purchase_orders where id = p_po_id;
end;
$function$;
