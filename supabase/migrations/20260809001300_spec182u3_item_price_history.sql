-- Spec 182 U3 — item_price_history: the "what did we pay last time" benchmark.
--
-- Above the quote-comparison table (U1/U2) the buyer wants a reference: the most
-- recent price actually paid for this same catalog item (the spec-179 link). This
-- reads past PURCHASED purchase_requests for a catalog item and returns the NET
-- unit price — apples-to-apples with the net quotes (purchase_requests.amount is
-- the line GROSS, spec 119; net = amount / (1 + vat_rate/100); per unit = / qty).
--
-- Money posture (ADR 0038, same as purchase_quotes): unit price is sensitive, so
-- this is SECURITY DEFINER + a back-office role gate — site_admin (and anon) get
-- nothing. project_director rides along on any PM-named gate (pgTAP file 91).
-- DEFINER also lets the cross-project price benchmark see purchases beyond the
-- caller's project membership (a price reference is org-wide).

create function public.item_price_history(p_catalog_item_id uuid)
returns table (
  supplier_name  text,
  net_unit_price numeric,
  quantity       numeric,
  purchased_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in
     ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'item_price_history: role not permitted' using errcode = '42501';
  end if;

  return query
  select
    coalesce(s.name, pr.supplier)                                            as supplier_name,
    round((pr.amount / (1 + pr.vat_rate / 100.0)) / nullif(pr.quantity, 0), 2) as net_unit_price,
    pr.quantity                                                              as quantity,
    pr.purchased_at                                                          as purchased_at
  from public.purchase_requests pr
  left join public.suppliers s on s.id = pr.supplier_id
  where pr.catalog_item_id = p_catalog_item_id
    and pr.amount is not null
    and pr.quantity > 0
  order by coalesce(pr.purchased_at, pr.requested_at) desc
  limit 5;
end;
$$;

revoke all on function public.item_price_history(uuid) from public, anon;
grant execute on function public.item_price_history(uuid) to authenticated;

comment on function public.item_price_history(uuid) is
  'Spec 182 U3 — recent NET unit prices paid for a catalog item (back-office only), newest first (limit 5). The last-paid benchmark above the quote comparison.';
