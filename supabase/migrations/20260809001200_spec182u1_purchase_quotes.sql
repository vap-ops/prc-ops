-- Spec 182 U1 — purchase_quotes: structured supplier quotes for price comparison.
--
-- Procurement's price comparison is offline today (pick one supplier, type the
-- amount into the PO; losing quotes vanish). This captures N supplier quotes per
-- approved PR so they can be compared side-by-side and the winner flows into the
-- PO (U2). unit_price is the sensitive field — more than PO existence — so the
-- table is BACK-OFFICE-READ ONLY (PM/procurement/super_admin, NOT site_admin);
-- writes go through SECURITY DEFINER RPCs (the suppliers/PO money posture, ADR
-- 0038).

create table public.purchase_quotes (
  id                  uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  supplier_id         uuid not null references public.suppliers(id),
  -- The quoted NET unit price (pre-VAT); total = unit_price * pr.quantity. The
  -- PO applies its own vat_rate on top (ADR 0045).
  unit_price          numeric(12, 2) not null,
  note                text,
  created_by          uuid references public.users(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  constraint purchase_quotes_price_nonneg check (unit_price >= 0),
  -- One current quote per supplier per PR (re-quote = remove + re-add).
  constraint purchase_quotes_supplier_uniq unique (purchase_request_id, supplier_id)
);

create index purchase_quotes_pr_idx on public.purchase_quotes (purchase_request_id);

alter table public.purchase_quotes enable row level security;
revoke all on public.purchase_quotes from anon, authenticated;
grant select on public.purchase_quotes to authenticated;

-- READ: back-office money audience only — PM / procurement / super_admin. Site
-- staff price nothing (unit_price stays hidden from them). Site-wide (no project
-- scoping), like suppliers / purchase_orders (ADR 0026/0038).
create policy "purchase_quotes readable by back office"
  on public.purchase_quotes for select to authenticated
  using (
    (select public.current_user_role()) in
      ('project_manager', 'procurement', 'super_admin', 'project_director')
  );
-- No write policy — add_purchase_quote / remove_purchase_quote (definer) are the
-- sole write path.

comment on table public.purchase_quotes is
  'Spec 182 — supplier quotes (net unit price) for an approved PR, for price comparison. Back-office read only; written via SECURITY DEFINER RPCs.';

-- ----------------------------------------------------------------------------
-- add_purchase_quote — record a supplier's quote on an APPROVED purchase request.
-- ----------------------------------------------------------------------------
create function public.add_purchase_quote(
  p_purchase_request_id uuid,
  p_supplier_id         uuid,
  p_unit_price          numeric,
  p_note                text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.purchase_request_status;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_id     uuid;
begin
  if public.current_user_role() not in
     ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'add_purchase_quote: role not permitted' using errcode = '42501';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'add_purchase_quote: unit_price must be >= 0' using errcode = '22023';
  end if;

  select pr.status into v_status from public.purchase_requests pr where pr.id = p_purchase_request_id;
  if v_status is null then
    raise exception 'add_purchase_quote: unknown purchase request' using errcode = '22023';
  end if;
  -- Quoting is the pre-PO sourcing step: an APPROVED PR awaiting purchase.
  if v_status <> 'approved' then
    raise exception 'add_purchase_quote: the request must be approved (awaiting purchase)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id) then
    raise exception 'add_purchase_quote: unknown supplier' using errcode = '22023';
  end if;

  insert into public.purchase_quotes (purchase_request_id, supplier_id, unit_price, note)
  values (p_purchase_request_id, p_supplier_id, p_unit_price, v_note)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_purchase_quote(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.add_purchase_quote(uuid, uuid, numeric, text) to authenticated;

comment on function public.add_purchase_quote(uuid, uuid, numeric, text) is
  'Spec 182 U1 — record a supplier net-unit-price quote on an approved PR (PM/procurement/super). Dup supplier per PR → 23505.';

-- ----------------------------------------------------------------------------
-- remove_purchase_quote — drop a quote (cleanup / re-quote).
-- ----------------------------------------------------------------------------
create function public.remove_purchase_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in
     ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'remove_purchase_quote: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.purchase_quotes q where q.id = p_quote_id) then
    raise exception 'remove_purchase_quote: unknown quote' using errcode = '22023';
  end if;

  delete from public.purchase_quotes where id = p_quote_id;
end;
$$;

revoke all on function public.remove_purchase_quote(uuid) from public, anon;
grant execute on function public.remove_purchase_quote(uuid) to authenticated;

comment on function public.remove_purchase_quote(uuid) is
  'Spec 182 U1 — remove a purchase quote (PM/procurement/super).';
