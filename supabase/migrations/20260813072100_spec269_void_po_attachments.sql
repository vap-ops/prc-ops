-- Spec 269 — void a purchase order that has attachments (bug fix).
-- Amends spec 259 (void_purchase_order), spec 125 / ADR 0046 (PO attachments
-- append-only posture), ADR 0038 (purchase write-path family).
--
-- LIVE INCIDENT (PO-4073, 2026-07-06): void_purchase_order fails P0001 for ANY
-- purchase order that has a purchase_order_attachments row — 22 of 27 POs at
-- discovery. Root cause: the RPC ends with `delete from purchase_orders`,
-- whose ON DELETE CASCADE on purchase_order_attachments requests exactly the
-- DELETE that the table's append-only block-write trigger forbids, so the
-- whole void aborts. A child-FK sweep of the LIVE PO delete graph confirms
-- attachments is the ONLY blocking child (deliveries/charges cascade clean;
-- purchase_requests is nulled by the RPC before the delete).
--
-- Fix, both by CREATE OR REPLACE (no signature change -> grants/ACLs preserved,
-- no db:types drift, no anon-regrant hazard):
--
-- 1. purchase_order_attachments_block_write() gains ONE carve-out: a DELETE is
--    allowed iff the parent PO row is already gone — a state only the
--    purchase_orders ON DELETE CASCADE can produce within a statement (the FK
--    guarantees a live parent for every other path). UPDATE, TRUNCATE, and any
--    direct DELETE while the parent exists still raise P0001 unchanged.
--    Parent-gone is chosen over pg_trigger_depth() (which would also pass for
--    unrelated nested-trigger contexts) and fails CLOSED.
--
-- 2. void_purchase_order() — body re-sourced VERBATIM from LIVE
--    (pg_get_functiondef, 2026-07-06; includes the spec 261 manager-only gate
--    and the spec 260 charge-reversal loop) with exactly three edits:
--    (a) the audit payload additionally snapshots every attachment row of the
--        PO ('attachments' array) BEFORE the delete, so the append-only intent
--        (history is never silently lost) survives in the append-only
--        audit_log; the storage objects in the private po-attachments bucket
--        are intentionally orphaned (paths retained in the payload — see spec
--        269 D3);
--    (b) 'purchase order not found' raises errcode PO404 (was blanket P0001);
--    (c) 'order has a shipped or received line' raises errcode PO409 (was
--        blanket P0001) — so the app can show honest Thai errors instead of
--        one misleading catch-all.

-- 1. The append-only trigger: cascade carve-out.
create or replace function public.purchase_order_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  -- Spec 269 carve-out: the ONLY permitted write is the DELETE issued by the
  -- purchase_orders ON DELETE CASCADE while void_purchase_order removes the
  -- parent PO. In that path the parent row is already gone within this same
  -- statement — a state no direct DELETE can reach (the FK guarantees a live
  -- parent otherwise) — and the rows' history has just been written into the
  -- purchase_order_void audit payload. Everything else (UPDATE, TRUNCATE, a
  -- direct DELETE with the parent alive) still raises, keeping the table
  -- append-only for every user-reachable path. tg_op is checked in its own
  -- IF so the statement-level TRUNCATE trigger (where OLD is null) can never
  -- evaluate the OLD reference.
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.purchase_orders po
       where po.id = old.purchase_order_id
    ) then
      return old;
    end if;
  end if;
  raise exception
    'purchase_order_attachments is append-only: % is not allowed (supersede via INSERT instead)',
    tg_op
    using errcode = 'P0001';
end;
$$;

-- 2. void_purchase_order: attachments audit snapshot + distinct errcodes.
create or replace function public.void_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
          not in ('project_manager', 'procurement_manager', 'super_admin', 'project_director') then
    raise exception 'void_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  select po_number, supplier into v_po_number, v_supplier
    from public.purchase_orders
   where id = p_po_id;
  if v_po_number is null then
    -- Spec 269: distinct errcode (was blanket P0001) so the UI can say
    -- "not found" honestly.
    raise exception 'void_purchase_order: purchase order not found'
      using errcode = 'PO404';
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
    -- Spec 269: distinct errcode (was blanket P0001).
    raise exception 'void_purchase_order: order has a shipped or received line'
      using errcode = 'PO409';
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

  -- Spec 260: the PO's charges cascade on the FK, but their GL entries / outbox
  -- jobs do not — reverse a posted charge entry or skip a pending job first
  -- (identical shape to the member loop), so a voided PO leaves no phantom
  -- charge posting behind.
  for v_member in
    select id from public.purchase_order_charges where purchase_order_id = p_po_id
  loop
    select e.id into v_old_entry
      from public.journal_entries e
     where e.source_table = 'purchase_order_charges'
       and e.source_id    = v_member.id
       and e.source_event = 'po_charge'
       and e.status       = 'posted'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
     limit 1;
    if v_old_entry is not null then
      perform public.reverse_journal_internal(
        v_old_entry, auth.uid(), 'void: purchase order reverted (charge)');
    end if;

    update public.gl_posting_outbox
       set status = 'skipped'
     where source_table = 'purchase_order_charges'
       and source_id    = v_member.id
       and source_event = 'po_charge'
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
       'request_ids', to_jsonb(v_request_ids),
       -- Spec 269: snapshot the attachment rows this void's cascade is about
       -- to delete — the append-only history moves into this durable,
       -- append-only payload (storage objects stay in the bucket; these
       -- storage_paths are the recovery index).
       'attachments', coalesce(
         (select jsonb_agg(jsonb_build_object(
                   'id',            a.id,
                   'kind',          a.kind,
                   'purpose',       a.purpose,
                   'delivery_id',   a.delivery_id,
                   'storage_path',  a.storage_path,
                   'superseded_by', a.superseded_by,
                   'created_by',    a.created_by,
                   'created_at',    a.created_at)
                 order by a.created_at, a.id)
            from public.purchase_order_attachments a
           where a.purchase_order_id = p_po_id),
         '[]'::jsonb)
     ));

  -- purchase_order_deliveries + purchase_order_charges cascade on their FKs;
  -- purchase_order_attachments now cascades too (the block-write trigger's
  -- spec 269 carve-out — history is in the audit payload above); the PO's
  -- po_number is retired, never reused (the running-sequence rule).
  delete from public.purchase_orders where id = p_po_id;
end;
$$;
