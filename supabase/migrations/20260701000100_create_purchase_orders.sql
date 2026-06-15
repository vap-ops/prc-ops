-- Spec 115 / ADR 0044 — purchase_orders: group N approved purchase_requests into
-- one supplier order. Phase 1 = the data layer only (no UI; that is spec 116).
--
-- MONEY POSTURE (§3): amount stays per-ticket on purchase_requests.amount; the
-- PO total is the SUM (computed, not stored — src/lib/purchasing/purchase-order.ts
-- purchaseOrderTotal). purchase_orders carries NO money column, so per-WP material
-- spend (specs 100/103/106) keeps reading each ticket's amount exactly. No new
-- authenticated amount grant.
--
-- WRITE POSTURE (§6, ADR 0038): the ONLY writer is the create_purchase_order
-- SECURITY DEFINER RPC. The table has SELECT for back office and NO direct
-- INSERT/UPDATE/DELETE policy. appsheet_writer is unaffected (current_user_role()
-- is NULL for it).

-- 1. purchase_orders table + its own running number (mirrors pr_number).
create sequence public.purchase_orders_po_number_seq;

create table public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  po_number   bigint not null default nextval('public.purchase_orders_po_number_seq')
                unique,
  supplier_id uuid not null references public.suppliers(id),
  supplier    text not null,
  eta         date null,
  ordered_at  timestamptz null,
  notes       text null,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint purchase_orders_notes_len check (notes is null or length(notes) <= 2000)
);

alter sequence public.purchase_orders_po_number_seq
  owned by public.purchase_orders.po_number;

create index purchase_orders_supplier_id_idx
  on public.purchase_orders (supplier_id);

-- updated_at maintenance via the shared trigger (work_packages / purchase_requests
-- convention). No UPDATE path ships in phase 1, but the column is maintained the
-- same way for spec 116.
create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- 2. The member FK on purchase_requests. A ticket belongs to 0 or 1 PO (§2).
--    Written only by the RPC (the column-scoped authenticated UPDATE grant in
--    20260616000400 does NOT name purchase_order_id, so app sessions cannot set
--    it directly — the ADR 0038 fact-column posture). Indexed for the PO →
--    members read (the status/total roll-up + grouped display in spec 116).
alter table public.purchase_requests
  add column purchase_order_id uuid null references public.purchase_orders(id);

create index purchase_requests_purchase_order_id_idx
  on public.purchase_requests (purchase_order_id);

-- 3. RLS. SELECT mirrors purchase_requests' privileged branch, site-wide
--    (site_admin / project_manager / procurement / super_admin, ADR 0026); POs
--    carry no money and have no requester self-view. NO INSERT/UPDATE/DELETE
--    policy — the RPC (function owner) is the only writer (ADR 0038). Eval-once
--    wrapped call form (20260625000600): (select public.current_user_role())
--    evaluates once per query, not per row.
alter table public.purchase_orders enable row level security;
revoke all on public.purchase_orders from anon, authenticated;
grant select on public.purchase_orders to authenticated;

create policy "purchase_orders readable by back office"
  on public.purchase_orders for select
  to authenticated
  using (
    (select public.current_user_role()) in (
      'site_admin', 'project_manager', 'procurement', 'super_admin'
    )
  );

-- 4. create_purchase_order — atomic, all-or-nothing (§4). Bundles approved
--    tickets under one supplier order: insert the PO, then per line guard
--    status='approved' and stamp amount/supplier/eta/purchased_at/status=
--    'purchased'/purchase_order_id. Mirrors record_purchase per line; the
--    approved→purchased UPDATE fires the existing trigger chain (derive status,
--    the 'purchase_request_purchase' audit row, notification capture), so this
--    function writes exactly ONE extra audit row: the PO-create row.
--
--    INVOCATION (spec-68 lesson): this role-gated DEFINER RPC must run on the
--    AUTHENTICATED session, never the admin/service-role client — service-role
--    has no JWT, so auth.uid() is NULL and current_user_role() would refuse it
--    (and created_by NOT NULL would fail). grant execute to authenticated.
create function public.create_purchase_order(
  p_supplier_id uuid,
  p_eta date,
  p_lines jsonb
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
  -- Back-office gate on the authenticated session.
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin') then
    raise exception 'create_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  -- A PO must bundle at least one line.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'create_purchase_order: no lines'
      using errcode = 'P0001';
  end if;

  -- Supplier snapshot (the spec-33 pattern): resolve the name once from the FK.
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

  -- Each line: {request_id, amount}. Guard the PR is approved, then stamp it.
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

  -- One PO-create audit row (the per-line purchase rows come from the existing
  -- purchase_requests_audit_appsheet trigger). Real actor on the user session.
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
       'line_count',  jsonb_array_length(p_lines),
       'request_ids', to_jsonb(v_request_ids)
     ));

  return v_po_id;
end;
$$;

revoke all on function public.create_purchase_order(uuid, date, jsonb)
  from public, anon;
grant execute on function public.create_purchase_order(uuid, date, jsonb)
  to authenticated;
