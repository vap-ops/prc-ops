-- Spec 135 U1 / ADR 0054 — first-class deliveries. A PO ships in deliveries
-- procurement arranges; this is the data layer. Additive: it does NOT touch the
-- receive/split RPCs and LEAVES delivery_batch_id (U7) in place so the U9 reads keep
-- working until U2 migrates the app onto delivery_id and a later migration retires
-- the batch column.
--
-- WRITE POSTURE (ADR 0038): the only writer of purchase_order_deliveries + of
-- purchase_requests.delivery_id is a SECURITY DEFINER RPC (create_purchase_order
-- here; the split-delivery RPC in U3). No direct INSERT/UPDATE policy; the
-- authenticated column-scoped UPDATE grant (20260616000400) does not name
-- delivery_id, so app sessions can't set it.

-- 1. The deliveries table. cost is the per-delivery shipping fee (money — UI gates
--    display to back office like amount, spec 106). carrier is the future
--    Lalamove/courier hook (ADR 0054 / U4b).
create table public.purchase_order_deliveries (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  eta               date null,
  note              text null,
  cost              numeric null,
  carrier           text null,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pod_note_len     check (note is null or length(note) <= 2000),
  constraint pod_cost_nonneg  check (cost is null or cost >= 0)
);

create index purchase_order_deliveries_po_idx
  on public.purchase_order_deliveries (purchase_order_id);

create trigger purchase_order_deliveries_set_updated_at
  before update on public.purchase_order_deliveries
  for each row execute function public.set_updated_at();

-- 2. RLS. SELECT mirrors purchase_orders (back-office site-wide, ADR 0026); NO
--    direct write policy — the RPC (function owner) is the only writer.
alter table public.purchase_order_deliveries enable row level security;
revoke all on public.purchase_order_deliveries from anon, authenticated;
grant select on public.purchase_order_deliveries to authenticated;

create policy "purchase_order_deliveries readable by back office"
  on public.purchase_order_deliveries for select
  to authenticated
  using (
    (select public.current_user_role()) in (
      'site_admin', 'project_manager', 'procurement', 'super_admin'
    )
  );

-- 3. The member FK. A line belongs to one delivery (supersedes delivery_batch_id,
--    which stays for now — retired in a later migration once the app is off it).
alter table public.purchase_requests
  add column delivery_id uuid null references public.purchase_order_deliveries(id);

create index purchase_requests_delivery_id_idx
  on public.purchase_requests (delivery_id);

-- 4. Backfill existing POs: one delivery per (PO, delivery_batch_id) group — so a
--    received batch becomes a delivery and the unbatched (pending/default) lines
--    become the default delivery. A plain single-delivery PO gets exactly one.
do $$
declare
  g             record;
  v_delivery_id uuid;
begin
  for g in
    select distinct pr.purchase_order_id, pr.delivery_batch_id
    from public.purchase_requests pr
    where pr.purchase_order_id is not null
  loop
    insert into public.purchase_order_deliveries (purchase_order_id, eta, created_by)
    select po.id, po.eta, po.created_by
    from public.purchase_orders po
    where po.id = g.purchase_order_id
    returning id into v_delivery_id;

    update public.purchase_requests pr
       set delivery_id = v_delivery_id
     where pr.purchase_order_id = g.purchase_order_id
       and pr.delivery_batch_id is not distinct from g.delivery_batch_id
       and pr.delivery_id is null;
  end loop;
end $$;

-- 5. create_purchase_order — auto-create the default delivery (= the whole PO) and
--    assign every member line to it, so every PO has >= 1 delivery (one render path;
--    the 85% never touch it). Body = the 20260701000300 (order_ref) version verbatim
--    + the delivery block; same signature, so CREATE OR REPLACE.
create or replace function public.create_purchase_order(
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
  v_delivery_id   uuid;
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
$$;

revoke all on function public.create_purchase_order(uuid, date, jsonb, numeric, text)
  from public, anon;
grant execute on function public.create_purchase_order(uuid, date, jsonb, numeric, text)
  to authenticated;
