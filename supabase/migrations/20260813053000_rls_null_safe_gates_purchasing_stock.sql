-- rls-audit-2026-07 Pass B / M-B3 purchasing / stock / store money RPCs — null-safe SECURITY DEFINER role gates (F1).
-- PO create/receive/record/ship/dispatch/split, site + divert purchase, stock in/issue/count/return/reverse (19 fns).
-- Each body is VERBATIM from LIVE (pg_get_functiondef, 2026-07-02) with ONE
-- mechanical edit per gate: a NULL role now fails the gate closed instead of
-- falling through (bare `not in` / `v_role not in` / `<>` / `= any` /
-- `v_is_staff := role in` forms all get an `is null`/`coalesce(...,false)`
-- guard). Real roles behave identically. All CREATE OR REPLACE (no signature
-- change) → grants preserved, no db:types drift, no pin churn.

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid, p_eta date, p_lines jsonb, p_vat_rate numeric DEFAULT 0, p_order_ref text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supplier_name text;
  v_order_ref     text := nullif(trim(coalesce(p_order_ref, '')), '');
  v_po_id         uuid;
  v_po_number     bigint;
  v_line          jsonb;
  v_request_id    uuid;
  v_amount        numeric;
  v_request_ids   uuid[] := '{}';
  v_delivery_id   uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
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

  -- Spec 135 U1: the default delivery = the whole PO (auto). Member lines join it.
  insert into public.purchase_order_deliveries (purchase_order_id, eta, created_by)
  values (v_po_id, p_eta, auth.uid())
  returning id into v_delivery_id;

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
           purchase_order_id = v_po_id,
           delivery_id       = v_delivery_id
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
       'delivery_id', v_delivery_id,
       'line_count',  jsonb_array_length(p_lines),
       'request_ids', to_jsonb(v_request_ids)
     ));

  return v_po_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.receive_po_lines(p_request_ids uuid[], p_received_by text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id    uuid;
  v_count integer := 0;
  v_batch uuid := gen_random_uuid();
begin
  -- Receiving is a site action (site_admin / project_manager / super_admin /
  -- project_director) PLUS procurement (spec 208 Q3 — the off-site team helps
  -- receive when site staff are short).
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'receive_po_lines: role not permitted' using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'receive_po_lines: no lines' using errcode = 'P0001';
  end if;

  foreach v_id in array p_request_ids loop
    update public.purchase_requests
       set delivered_at      = now(),
           received_by       = p_received_by,
           delivery_note     = p_delivery_note,
           delivery_batch_id = v_batch
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
$function$;

CREATE OR REPLACE FUNCTION public.record_purchase(p_purchase_request_id uuid, p_supplier_id uuid, p_order_ref text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_eta date DEFAULT NULL::date, p_vat_rate numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supplier_name text;
  v_order_ref text := nullif(trim(coalesce(p_order_ref, '')), '');
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
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
$function$;

CREATE OR REPLACE FUNCTION public.record_site_purchase(p_work_package_id uuid, p_item_description text, p_quantity numeric, p_unit text, p_reason_code purchase_request_reason_code, p_amount numeric DEFAULT NULL::numeric, p_vat_rate numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  -- project_director rides along with project_manager (spec 152 / ADR 0058;
  -- pgTAP file 91 pins that every PM-gated RPC also names it) — the LIVE gate
  -- carried it (added by 20260751); reconstructing from the pre-152 body would
  -- have dropped it.
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
  -- Spec 176 U4: the reactive-reason tag is required.
  if p_reason_code is null then
    raise exception 'record_site_purchase: reason code required'
      using errcode = 'P0001';
  end if;
  -- Spec 103: amount optional, positive when supplied.
  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_site_purchase: amount must be positive'
      using errcode = 'P0001';
  end if;

  -- WP existence. v1 access is role-level (ADR 0013 — no membership): the
  -- admitted roles read every WP, so there is no per-project scope to
  -- probe; the role gate + this existence check are the full visibility
  -- guard (ADR 0043 §6). Revisit if a per-project access model lands.
  if not exists (select 1 from public.work_packages wp where wp.id = p_work_package_id) then
    raise exception 'record_site_purchase: work package not found'
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit, amount, vat_rate, reason_code,
     status, source, requested_by, purchased_at, delivered_at, received_by, received_by_id)
  values
    (p_work_package_id, v_item, p_quantity, v_unit, p_amount, p_vat_rate, p_reason_code,
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
       'reason_code',      p_reason_code,
       'received_by',      v_actor
     ));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_shipment(p_purchase_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
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
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_purchase_order_delivery(p_delivery_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'dispatch_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.purchase_order_deliveries where id = p_delivery_id
  ) then
    raise exception 'dispatch_purchase_order_delivery: delivery not found'
      using errcode = 'P0001';
  end if;

  -- Mark the งวด's not-yet-shipped lines as shipped; the derive trigger flips
  -- purchased → on_route and the audit/notification triggers fire (no explicit writes
  -- here, the record_shipment posture). Already-shipped / delivered lines are left
  -- as-is, so a re-dispatch is a harmless 0-row no-op.
  update public.purchase_requests
     set shipped_at = now()
   where delivery_id = p_delivery_id
     and status = 'purchased'
     and shipped_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.split_purchase_order_delivery(p_purchase_order_id uuid, p_request_ids uuid[], p_eta date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_cost numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_delivery_id uuid;
  v_count       int;
  v_source      record;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
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

  -- Lock the selected rows first (a separate statement — FOR UPDATE is not allowed
  -- with an aggregate), so a concurrent split can't move the same line twice.
  perform 1
    from public.purchase_requests
   where id = any(p_request_ids)
   for update;

  -- Every selected id must be a distinct in-transit member of THIS PO. A count
  -- mismatch catches a non-member, an already-received (delivered) line, a
  -- rejected/cancelled line, and a duplicate id in one check.
  select count(*) into v_count
    from public.purchase_requests
   where id = any(p_request_ids)
     and purchase_order_id = p_purchase_order_id
     and status in ('purchased', 'on_route');

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
$function$;

CREATE OR REPLACE FUNCTION public.split_purchase_request_on_receipt(p_request_id uuid, p_received_qty numeric, p_received_by text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text, p_delivered_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig          public.purchase_requests%rowtype;
  v_remaining_qty numeric;
  v_delivered_amt numeric;
  v_remaining_amt numeric;
  v_child_id      uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
$function$;

CREATE OR REPLACE FUNCTION public.divert_purchase_to_store(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_project   uuid;
  v_wp        uuid;
  v_item      uuid;
  v_status    text;
  v_qty       numeric;
  v_amount    numeric;
  v_rate      numeric;
  v_net_total numeric(14, 2);
  v_supplier  uuid;
  v_requester uuid;
  v_actor     uuid;
  v_unit      text;
  v_unit_cost numeric(12, 2);
  v_old       uuid;
  v_id        uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'divert_purchase_to_store: role not permitted' using errcode = '42501';
  end if;

  select pr.project_id, pr.work_package_id, pr.catalog_item_id, pr.status::text,
         pr.quantity, pr.amount, coalesce(pr.vat_rate, 0), pr.supplier_id, pr.requested_by
    into v_project, v_wp, v_item, v_status, v_qty, v_amount, v_rate, v_supplier, v_requester
    from public.purchase_requests pr where pr.id = p_request_id;
  if v_project is null then
    raise exception 'divert_purchase_to_store: unknown purchase request' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'divert_purchase_to_store: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'delivered' then
    raise exception 'divert_purchase_to_store: purchase is not delivered' using errcode = '22023';
  end if;
  if v_wp is null then
    raise exception 'divert_purchase_to_store: purchase is not work-package-bound' using errcode = '22023';
  end if;
  if v_item is null then
    raise exception 'divert_purchase_to_store: purchase has no catalog item' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_receipts sr where sr.purchase_request_id = p_request_id) then
    raise exception 'divert_purchase_to_store: already diverted into the store' using errcode = '22023';
  end if;

  select c.unit into v_unit from public.catalog_items c where c.id = v_item;
  if v_unit is null then
    raise exception 'divert_purchase_to_store: unknown or inactive catalog item' using errcode = '22023';
  end if;

  v_actor := coalesce(auth.uid(), v_requester);

  -- 1. Reverse the WP-bound purchase's posted GL entry, if it has posted (this
  --    undoes Dr 1400 net + Dr 1300 Input VAT + Cr 2100 gross). The cost — and the
  --    Input VAT — leave the WP entry; the receipt re-books both (step 3).
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'purchase_requests'
     and e.source_id    = p_request_id
     and e.source_event = 'purchase'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'spec 198 U2: diverted to store');
  end if;

  -- 2. Skip any still-pending/posting purchase job so it can't post WP-WIP after
  --    the divert.
  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'purchase_requests'
     and source_id    = p_request_id
     and source_event = 'purchase'
     and status in ('pending', 'posting');

  -- 3. Receive into the store at NET cost (ex-VAT) + snapshot vat_rate, so the
  --    receipt poster splits Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross
  --    (U4b). With no VAT, net == gross — the prior all-in behaviour.
  if v_rate > 0 then
    v_net_total := round(coalesce(v_amount, 0) / (1 + v_rate / 100), 2);
  else
    v_net_total := coalesce(v_amount, 0);
  end if;
  v_unit_cost := round(v_net_total / nullif(v_qty, 0), 2);
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note,
     created_by, purchase_request_id, vat_rate)
  values
    (v_project, v_item, v_qty, v_unit, coalesce(v_unit_cost, 0), v_supplier,
     'ย้ายเข้าคลังจากงาน', auth.uid(), p_request_id, v_rate)
  returning id into v_id;

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, v_qty, v_qty * coalesce(v_unit_cost, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 4. The PR becomes store-bound — it joins the WP-less population.
  update public.purchase_requests set work_package_id = null where id = p_request_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.site_purchase_use_now(p_project_id uuid, p_work_package_id uuid, p_catalog_item_id uuid, p_qty numeric, p_unit_cost numeric, p_note text DEFAULT NULL::text, p_vat_rate numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_rate        numeric := coalesce(p_vat_rate, 0);
  v_net_total   numeric(14, 2);
  v_unit_net    numeric(12, 2);
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_decrement   numeric;
  v_sell        numeric;
  v_issue_id    uuid;
begin
  -- Role + membership (issue_stock's gate; procurement excluded).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'site_purchase_use_now: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'site_purchase_use_now: not a project member' using errcode = '42501';
  end if;
  -- The WP must belong to this project.
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'site_purchase_use_now: work package not in this project' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'site_purchase_use_now: qty must be > 0' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'site_purchase_use_now: unit_cost must be >= 0' using errcode = '22023';
  end if;
  if v_rate < 0 then
    raise exception 'site_purchase_use_now: vat_rate must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'site_purchase_use_now: unknown or inactive catalog item' using errcode = '22023';
  end if;

  -- Inventory carries the NET (ex-VAT) cost; reclaimable Input VAT is split to 1300
  -- by the receipt poster. p_unit_cost is the GROSS paid; with no VAT, net == gross
  -- (the prior all-in behaviour). Net derived at the TOTAL then back to a unit cost
  -- (mirrors purchase_requests_stock_in_on_receive's rounding, spec 208 U4b).
  if v_rate > 0 then
    v_net_total := round((p_qty * p_unit_cost) / (1 + v_rate / 100), 2);
  else
    v_net_total := p_qty * p_unit_cost;
  end if;
  v_unit_net := round(v_net_total / nullif(p_qty, 0), 2);

  -- 1) RECEIVE into the store at NET cost + snapshot vat_rate (the GL trigger books
  --    Dr 1500 net / Dr 1300 Input VAT when rate>0 / Cr 2100 gross).
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note, vat_rate)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, coalesce(v_unit_net, 0), null,
     coalesce(v_note, 'ซื้อใช้หน้างาน'), v_rate);

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * coalesce(v_unit_net, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 2) ISSUE to the WP at moving-average cost (the GL trigger books Dr 1400 / Cr
  --    1500). Lock the on-hand row we just rolled; sufficiency is guaranteed (we
  --    added p_qty), but keep the same lock/compute path as issue_stock.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  v_sell := coalesce(
    (select sell_rate from public.item_sell_rates where catalog_item_id = p_catalog_item_id),
    v_avg);
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
     receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_sell,
     coalesce(v_note, 'ซื้อใช้หน้างาน'), null)
  returning id into v_issue_id;

  return v_issue_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.issue_stock(p_project_id uuid, p_catalog_item_id uuid, p_work_package_id uuid, p_qty numeric, p_note text DEFAULT NULL::text, p_receiver_worker_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_sell        numeric;
  v_decrement   numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin draws at the WP, plus the PM tier.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'issue_stock: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock: not a project member' using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'issue_stock: qty must be > 0' using errcode = '22023';
  end if;
  -- The WP must belong to this project (you draw to a WP in the same store).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock: work package not in this project' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'issue_stock: unknown or inactive catalog item' using errcode = '22023';
  end if;
  -- A named receiver must be an ACTIVE worker on this project (or unassigned).
  if p_receiver_worker_id is not null and not exists (
    select 1 from public.workers w
     where w.id = p_receiver_worker_id and w.active
       and (w.project_id = p_project_id or w.project_id is null)
  ) then
    raise exception 'issue_stock: receiver is not an active worker on this project'
      using errcode = '22023';
  end if;

  -- Lock the on-hand row and check sufficiency.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_qty_on_hand is null or v_qty_on_hand < p_qty then
    raise exception 'issue_stock: insufficient stock on hand' using errcode = '22023';
  end if;

  -- Moving-average cost at issue (the cost basis). Decrement on-hand by qty and
  -- by qty*avg; fully depleting forces value to 0 so rounding dust never lingers.
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  -- Sell price snapshot (transfer price): the item's rate, else the cost (unpriced
  -- sells at cost → zero store margin, never null).
  v_sell := coalesce(
    (select sell_rate from public.item_sell_rates where catalog_item_id = p_catalog_item_id),
    v_avg);
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
     receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_sell, v_note,
     p_receiver_worker_id)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.issue_stock_bulk(p_project_id uuid, p_work_package_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_line        jsonb;
  v_item        uuid;
  v_qty         numeric;
  v_receiver    uuid;
  v_note        text;
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_sell        numeric;
  v_decrement   numeric;
  v_count       int := 0;
begin
  -- Role: SITE_STAFF_ROLES (issue is a member-only OUT; procurement is excluded).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'issue_stock_bulk: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock_bulk: not a project member' using errcode = '42501';
  end if;
  -- The WP must belong to this project (slip level — one slip, one WP).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock_bulk: work package not in this project' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'issue_stock_bulk: lines must be a non-empty json array' using errcode = '22023';
  end if;

  -- Atomic: validate + issue every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item     := (v_line ->> 'catalog_item_id')::uuid;
    v_qty      := (v_line ->> 'qty')::numeric;
    v_receiver := nullif(v_line ->> 'receiver_worker_id', '')::uuid;
    v_note     := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'issue_stock_bulk: qty must be > 0' using errcode = '22023';
    end if;
    -- Catalog item must exist and be active; snapshot its unit.
    select c.unit into v_unit
      from public.catalog_items c
     where c.id = v_item and c.is_active;
    if v_unit is null then
      raise exception 'issue_stock_bulk: unknown or inactive catalog item' using errcode = '22023';
    end if;
    -- A named receiver must be an ACTIVE worker on this project (or unassigned).
    if v_receiver is not null and not exists (
      select 1 from public.workers w
       where w.id = v_receiver and w.active
         and (w.project_id = p_project_id or w.project_id is null)
    ) then
      raise exception 'issue_stock_bulk: receiver is not an active worker on this project'
        using errcode = '22023';
    end if;

    -- Lock the on-hand row and check sufficiency (per line; interleaving safe).
    select qty_on_hand, total_value into v_qty_on_hand, v_value
      from public.stock_on_hand
     where project_id = p_project_id and catalog_item_id = v_item
     for update;
    if v_qty_on_hand is null or v_qty_on_hand < v_qty then
      raise exception 'issue_stock_bulk: insufficient stock on hand' using errcode = '22023';
    end if;

    -- Moving-average cost at issue; decrement qty + value; zero value on depletion
    -- so rounding dust never lingers (mirrors issue_stock exactly).
    v_avg := round(v_value / v_qty_on_hand, 2);
    v_decrement := v_qty * v_avg;
    v_sell := coalesce(
      (select sell_rate from public.item_sell_rates where catalog_item_id = v_item),
      v_avg);
    update public.stock_on_hand
       set qty_on_hand = v_qty_on_hand - v_qty,
           total_value = case when v_qty_on_hand - v_qty = 0 then 0 else v_value - v_decrement end,
           updated_at  = now()
     where project_id = p_project_id and catalog_item_id = v_item;

    insert into public.stock_issues
      (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
       receiver_worker_id)
    values
      (p_project_id, v_item, p_work_package_id, v_qty, v_unit, v_avg, v_sell, v_note, v_receiver);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_in(p_project_id uuid, p_catalog_item_id uuid, p_qty numeric, p_unit_cost numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_unit text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  -- Role: the cost-bearing curation tier PLUS site_admin (the on-site
  -- storekeeper who receives deliveries — spec 197 U1).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'record_stock_in: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA by membership / super/director see-all (can_see_project);
  -- procurement is a cross-project curator.
  if not (public.can_see_project(p_project_id) or v_role = 'procurement') then
    raise exception 'record_stock_in: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'record_stock_in: unknown project' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'record_stock_in: qty must be > 0' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'record_stock_in: unit_cost must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit onto the receipt.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'record_stock_in: unknown or inactive catalog item' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id
  ) then
    raise exception 'record_stock_in: unknown supplier' using errcode = '22023';
  end if;

  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, p_unit_cost, p_supplier_id, v_note)
  returning id into v_id;

  -- Roll into on-hand: a pure stock-IN is additive (qty + value); the moving-avg
  -- recompute only matters on issue-OUT (a later phase).
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * p_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_in_bulk(p_project_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role     public.user_role := public.current_user_role();
  v_line     jsonb;
  v_item     uuid;
  v_qty      numeric;
  v_cost     numeric;
  v_supplier uuid;
  v_note     text;
  v_unit     text;
  v_count    int := 0;
begin
  -- Role: site_admin (storekeeper) + the cost-bearing curation tier — identical
  -- to the post-spec-197 record_stock_in gate.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'record_stock_in_bulk: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA by membership / super/director see-all; procurement is a
  -- cross-project curator.
  if not (public.can_see_project(p_project_id) or v_role = 'procurement') then
    raise exception 'record_stock_in_bulk: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'record_stock_in_bulk: unknown project' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'record_stock_in_bulk: lines must be a non-empty json array' using errcode = '22023';
  end if;

  -- Atomic: validate + insert every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item     := (v_line ->> 'catalog_item_id')::uuid;
    v_qty      := (v_line ->> 'qty')::numeric;
    v_cost     := (v_line ->> 'unit_cost')::numeric;
    v_supplier := nullif(v_line ->> 'supplier_id', '')::uuid;
    v_note     := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'record_stock_in_bulk: qty must be > 0' using errcode = '22023';
    end if;
    if v_cost is null or v_cost < 0 then
      raise exception 'record_stock_in_bulk: unit_cost must be >= 0' using errcode = '22023';
    end if;
    -- Catalog item must exist and be active; snapshot its unit onto the receipt.
    select c.unit into v_unit
      from public.catalog_items c
     where c.id = v_item and c.is_active;
    if v_unit is null then
      raise exception 'record_stock_in_bulk: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_supplier is not null and not exists (
      select 1 from public.suppliers s where s.id = v_supplier
    ) then
      raise exception 'record_stock_in_bulk: unknown supplier' using errcode = '22023';
    end if;

    insert into public.stock_receipts
      (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
    values
      (p_project_id, v_item, v_qty, v_unit, v_cost, v_supplier, v_note);

    -- Roll into on-hand: a pure stock-IN is additive (qty + value).
    insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
    values (p_project_id, v_item, v_qty, v_qty * v_cost)
    on conflict (project_id, catalog_item_id) do update
      set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
          total_value = public.stock_on_hand.total_value + excluded.total_value,
          updated_at  = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_count(p_project_id uuid, p_catalog_item_id uuid, p_counted_qty numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_system_qty  numeric;
  v_value       numeric;
  v_avg         numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin keeps the physical store + the PM tier.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'record_stock_count: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'record_stock_count: not a project member' using errcode = '42501';
  end if;

  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'record_stock_count: counted qty must be >= 0' using errcode = '22023';
  end if;

  -- Lock the on-hand row; counting is limited to items the store tracks.
  select qty_on_hand, total_value into v_system_qty, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_system_qty is null then
    raise exception 'record_stock_count: item is not stocked in this store' using errcode = '22023';
  end if;

  -- Unit snapshot (the item may be deactivated but still physically on hand).
  select c.unit into v_unit from public.catalog_items c where c.id = p_catalog_item_id;

  -- Moving-average unit cost stays the count's valuation basis.
  v_avg := case when v_system_qty > 0 then round(v_value / v_system_qty, 2) else 0 end;

  insert into public.stock_counts
    (project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost, note)
  values
    (p_project_id, p_catalog_item_id, v_system_qty, p_counted_qty, v_unit, v_avg, v_note)
  returning id into v_id;

  -- Reconcile on-hand to the counted truth, valued at the (unchanged) avg cost.
  update public.stock_on_hand
     set qty_on_hand = p_counted_qty,
         total_value = round(p_counted_qty * v_avg, 2),
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_stock_to_store(p_issue_id uuid, p_qty numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role       public.user_role := public.current_user_role();
  v_project    uuid;
  v_item       uuid;
  v_wp         uuid;
  v_unit       text;
  v_issue_qty  numeric;
  v_unit_cost  numeric(12, 2);
  v_returned   numeric;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  -- Role: SITE_STAFF tier (a return is the same physical-custody action as เบิก;
  -- procurement is excluded, mirroring issue_stock).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'return_stock_to_store: role not permitted' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'return_stock_to_store: qty must be positive' using errcode = '22023';
  end if;

  select si.project_id, si.catalog_item_id, si.work_package_id, si.unit, si.qty, si.unit_cost
    into v_project, v_item, v_wp, v_unit, v_issue_qty, v_unit_cost
    from public.stock_issues si where si.id = p_issue_id;
  if v_project is null then
    raise exception 'return_stock_to_store: unknown issue' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'return_stock_to_store: not a project member' using errcode = '42501';
  end if;

  -- A reversed (voided) issue never charged the WP — there is nothing to return;
  -- correct it via the mistake-undo instead.
  if exists (select 1 from public.stock_reversals r where r.issue_id = p_issue_id) then
    raise exception 'return_stock_to_store: issue was reversed' using errcode = '22023';
  end if;

  -- Cannot return more than was issued (net of prior returns).
  select coalesce(sum(r.qty), 0) into v_returned
    from public.stock_returns r where r.issue_id = p_issue_id;
  if p_qty > v_issue_qty - v_returned then
    raise exception 'return_stock_to_store: cannot return more than was issued' using errcode = '22023';
  end if;

  insert into public.stock_returns
    (project_id, catalog_item_id, issue_id, work_package_id, qty, unit, unit_cost, note, returned_by)
  values
    (v_project, v_item, p_issue_id, v_wp, p_qty, v_unit, v_unit_cost, v_note, auth.uid())
  returning id into v_id;

  -- Re-enter the store at the issue cost (the insert's enqueue trigger books
  -- Dr 1500 / Cr 1400 on drain).
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, p_qty, p_qty * v_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_stock_issue(p_issue_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES (who records เบิก).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'reverse_stock_issue: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_issues where id = p_issue_id;
  if v_project is null then
    raise exception 'reverse_stock_issue: unknown issue' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'reverse_stock_issue: not a project member' using errcode = '42501';
  end if;

  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null then
    raise exception 'reverse_stock_issue: no on-hand row for this item' using errcode = '22023';
  end if;

  -- Record the reversal first (unique index blocks a double reversal → 23505).
  insert into public.stock_reversals (project_id, catalog_item_id, issue_id, qty, value_delta, note)
  values (v_project, v_item, p_issue_id, v_qty, v_total_cost, v_note)
  returning id into v_id;

  -- Add the issued qty/value back to on-hand.
  update public.stock_on_hand
     set qty_on_hand = v_on_hand + v_qty,
         total_value = v_value + v_total_cost,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_stock_receipt(p_receipt_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'reverse_stock_receipt: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_receipts where id = p_receipt_id;
  if v_project is null then
    raise exception 'reverse_stock_receipt: unknown receipt' using errcode = '22023';
  end if;
  if not (public.can_see_project(v_project) or v_role = 'procurement') then
    raise exception 'reverse_stock_receipt: not a project member' using errcode = '42501';
  end if;

  insert into public.stock_reversals (project_id, catalog_item_id, receipt_id, qty, value_delta, note)
  values (v_project, v_item, p_receipt_id, v_qty, -v_total_cost, v_note)
  returning id into v_id;

  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null or v_on_hand < v_qty then
    raise exception 'reverse_stock_receipt: stock already moved, cannot reverse'
      using errcode = '22023';
  end if;

  update public.stock_on_hand
     set qty_on_hand = v_on_hand - v_qty,
         total_value = case when v_on_hand - v_qty = 0 then 0 else v_value - v_total_cost end,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_stock_issue_on_behalf(p_issue_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_project   uuid;
  v_receiver  uuid;
  v_received  timestamptz;
  v_issued_by uuid;
begin
  -- PM tier only (operator gate). NOT site_admin (often the issuer), NOT the
  -- worker portal (that is confirm_stock_issue).
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'confirm_stock_issue_on_behalf: role not permitted' using errcode = '42501';
  end if;

  select project_id, receiver_worker_id, received_at, issued_by
    into v_project, v_receiver, v_received, v_issued_by
    from public.stock_issues where id = p_issue_id;
  if not found then
    raise exception 'confirm_stock_issue_on_behalf: unknown issue' using errcode = '22023';
  end if;
  -- Membership: PM by project membership; super/director see-all.
  if not public.can_see_project(v_project) then
    raise exception 'confirm_stock_issue_on_behalf: not a project member' using errcode = '42501';
  end if;
  if v_receiver is null then
    raise exception 'confirm_stock_issue_on_behalf: no receiver named on this issue'
      using errcode = '22023';
  end if;
  if v_received is not null then
    raise exception 'confirm_stock_issue_on_behalf: already confirmed' using errcode = '22023';
  end if;
  -- Separation of duties: the issuer cannot confirm their own handoff.
  if v_issued_by is not null and v_issued_by = auth.uid() then
    raise exception 'confirm_stock_issue_on_behalf: the issuer cannot confirm their own handoff'
      using errcode = '42501';
  end if;

  update public.stock_issues
     set received_at = now(), received_on_behalf = true, received_by = auth.uid()
   where id = p_issue_id;
end;
$function$;
