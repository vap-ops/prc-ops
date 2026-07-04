-- Spec 262 U1 / procurement chain S4 — purchase_report(): one bucketed
-- procurement-spend aggregate RPC. day/เดือน/ปี buckets × {project, supplier,
-- category, purchaser, none}, over the committed-spend PR set, with spec-260
-- PO-level charges folded in. READ-only (SECURITY DEFINER over the money columns
-- that authenticated cannot see — amount / vat_rate, and the charges table).
--
-- Design (grounded in ADRs 0044/0045/0063, specs 260/261, the dashboard fold):
--   * Population — purchase_requests in the "committed spend" status set
--     (purchased/on_route/delivered/site_purchased — the SPEND_STATUSES the
--     dashboard uses), bucketed by purchased_at (ยอดสั่งซื้อ = when the order was
--     placed). requested/approved/rejected/cancelled are excluded.
--   * Money — amount is GROSS (ADR 0045); net = round2(amount/(1+vat_rate/100)),
--     vat = gross − net; summed in satang (round at the line, sum the rounded —
--     matches summarizePurchases / the spec-260 GL poster).
--   * Charges (spec 260) — each PO's charges are allocated over its committed
--     member lines proportionally by line NET (transport/other add, discount
--     subtracts by type; amount is always positive), net and vat allocated
--     separately with a non-negative largest-remainder (Hamilton) split so every
--     slice sums EXACTLY to the true total. charge_gross is its own column. The
--     allocation base is the PO's committed-in-window lines across ALL projects,
--     so a p_project_id filter selects that project's proportional share of a
--     mixed-project PO's charge (not the whole charge). purchase_order_deliveries
--     .cost is courier metadata only (spec 260) — NOT read here, so no double count.
--   * Time zone — the DB session tz is UTC; buckets and the window use the
--     Asia/Bangkok business day so a Thai day/month/year is correct and the result
--     is deterministic regardless of session tz. (Deviation from the register's
--     UTC date filter — the S5 drill/parity must account for it.)
--   * Dimensions — project (project_id, NOT NULL); supplier
--     (coalesce(po.supplier_id, pr.supplier_id) → suppliers.name; null →
--     "ไม่ระบุผู้ขาย"); category (catalog_item_id → catalog_items.category_id →
--     catalog_categories.name; null → "ไม่ระบุหมวด"); purchaser (requested_by →
--     users.full_name; null → "ไม่ระบุผู้สั่งซื้อ"). Null buckets are shown, never
--     dropped (a data-quality signal the manager should see).
--   * Gate — procurement | procurement_manager | project_manager |
--     project_director | super_admin | accounting (inline literals: satisfies the
--     90-project-director and 261-procurement-parity source-scan invariants; fails
--     closed on a NULL role). The by-purchaser slice additionally requires the
--     manager tier ∪ procurement_manager (staff-performance data) — enforced here,
--     not just in the UI.
--
-- Budget-vs-actual is deliberately NOT in this RPC: the actual side is
-- purchase_report(group_by='project'); the budget side is projects.budget_amount_thb,
-- which authenticated cannot read (per-column grant omits it) — S5 reads it via the
-- admin client behind the same role gate, at PROJECT grain only (no per-category /
-- time-phased budget exists; BOQ has no project FK, supply plans are qty-only).

create or replace function public.purchase_report(
  p_from       date,
  p_to         date,
  p_bucket     text,               -- 'day' | 'month' | 'year'
  p_group_by   text,               -- 'project' | 'supplier' | 'category' | 'purchaser' | 'none'
  p_project_id uuid default null
)
returns table (
  bucket       date,
  group_key    text,
  group_label  text,
  line_gross   numeric,
  charge_gross numeric,
  gross        numeric,
  net          numeric,
  vat          numeric,
  pr_count     int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- Role gate (fail-closed on NULL role).
  if not coalesce(v_role in (
       'procurement', 'procurement_manager', 'project_manager',
       'project_director', 'super_admin', 'accounting'), false) then
    raise exception 'purchase_report: role not permitted' using errcode = '42501';
  end if;

  -- Param validation.
  if p_bucket not in ('day', 'month', 'year') then
    raise exception 'purchase_report: invalid bucket %', p_bucket using errcode = '22023';
  end if;
  if p_group_by not in ('project', 'supplier', 'category', 'purchaser', 'none') then
    raise exception 'purchase_report: invalid group_by %', p_group_by using errcode = '22023';
  end if;

  -- The by-purchaser slice is staff-performance data — manager tier ∪ procurement_manager only.
  if p_group_by = 'purchaser'
     and not coalesce(public.is_manager(v_role) or v_role = 'procurement_manager', false) then
    raise exception 'purchase_report: purchaser slice requires manager tier'
      using errcode = '42501';
  end if;

  return query
  with
  -- Committed member lines in [p_from, p_to] (Asia/Bangkok business day), ALL
  -- projects — so cross-project charge shares stay correct; p_project_id is
  -- applied at the final aggregation, not here.
  pop as (
    select
      pr.id,
      pr.project_id,
      pr.purchase_order_id,
      pr.supplier_id                                  as pr_supplier_id,
      pr.catalog_item_id,
      pr.requested_by,
      date_trunc(p_bucket, (pr.purchased_at at time zone 'Asia/Bangkok'))::date as bkt,
      round(coalesce(pr.amount, 0) * 100)::bigint      as line_gross_sat,
      case when pr.vat_rate <= 0 then round(coalesce(pr.amount, 0) * 100)
           else round(round(coalesce(pr.amount, 0) / (1 + pr.vat_rate / 100), 2) * 100)
      end::bigint                                      as line_net_sat,
      -- allocation weight = line NET (un-rounded), 0 when amount is null
      coalesce(pr.amount, 0) / (1 + pr.vat_rate / 100) as w
    from public.purchase_requests pr
    where pr.status in ('purchased', 'on_route', 'delivered', 'site_purchased')
      and pr.purchased_at is not null
      and (pr.purchased_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  ),
  -- Each in-scope PO's charges, gross → net/vat satang (ADR 0045), sign by type.
  chg as (
    select
      c.id                                              as charge_id,
      c.purchase_order_id                               as po_id,
      case when c.charge_type = 'discount' then -1 else 1 end as sgn,
      case when c.vat_rate <= 0 then round(c.amount * 100)
           else round(round(c.amount / (1 + c.vat_rate / 100), 2) * 100)
      end::bigint                                       as net_sat,
      case when c.vat_rate <= 0 then 0
           else round(c.amount * 100) - round(round(c.amount / (1 + c.vat_rate / 100), 2) * 100)
      end::bigint                                       as vat_sat
    from public.purchase_order_charges c
    where c.purchase_order_id in (
      select distinct purchase_order_id from pop where purchase_order_id is not null)
  ),
  potot as (
    select purchase_order_id as po_id, sum(w) as total_w, count(*)::int as n
    from pop where purchase_order_id is not null group by purchase_order_id
  ),
  -- Ideal satang per (charge, line), weighted by line net (equal split if total_w = 0).
  ideal as (
    select
      ch.charge_id, ch.sgn, p.id as line_id, ch.net_sat, ch.vat_sat, p.w,
      case when t.total_w > 0 then ch.net_sat * p.w / t.total_w
           else ch.net_sat::numeric / t.n end as net_ideal,
      case when t.total_w > 0 then ch.vat_sat * p.w / t.total_w
           else ch.vat_sat::numeric / t.n end as vat_ideal
    from chg ch
    join pop   p on p.purchase_order_id = ch.po_id
    join potot t on t.po_id = ch.po_id
  ),
  floored as (
    select charge_id, sgn, line_id, net_sat, vat_sat, w,
           floor(net_ideal) as net_fl, net_ideal - floor(net_ideal) as net_frac,
           floor(vat_ideal) as vat_fl, vat_ideal - floor(vat_ideal) as vat_frac
    from ideal
  ),
  -- Largest-remainder: hand the leftover satang to the largest fractional
  -- remainders (weight desc, then line id — deterministic). Positive shares only.
  ranked as (
    select f.*,
           net_sat - sum(net_fl) over (partition by charge_id) as net_left,
           vat_sat - sum(vat_fl) over (partition by charge_id) as vat_left,
           row_number() over (partition by charge_id order by net_frac desc, w desc, line_id) as net_rank,
           row_number() over (partition by charge_id order by vat_frac desc, w desc, line_id) as vat_rank
    from floored f
  ),
  -- Per committed line: its signed charge net/vat satang across the PO's charges.
  line_charge as (
    select line_id,
           sum(sgn * (net_fl + case when net_rank <= net_left then 1 else 0 end))::bigint as c_net_sat,
           sum(sgn * (vat_fl + case when vat_rank <= vat_left then 1 else 0 end))::bigint as c_vat_sat
    from ranked
    group by line_id
  ),
  enriched as (
    select
      p.bkt as bucket,
      case p_group_by
        when 'project'   then p.project_id::text
        when 'supplier'  then coalesce(coalesce(po.supplier_id, p.pr_supplier_id)::text, '')
        when 'category'  then coalesce(ci.category_id::text, '')
        when 'purchaser' then coalesce(p.requested_by::text, '')
        else 'all'
      end as group_key,
      case p_group_by
        when 'project'   then proj.name
        when 'supplier'  then coalesce(sup.name, 'ไม่ระบุผู้ขาย')
        when 'category'  then coalesce(cat.name, 'ไม่ระบุหมวด')
        when 'purchaser' then case when p.requested_by is null then 'ไม่ระบุผู้สั่งซื้อ'
                                   else coalesce(usr.full_name, 'ไม่ระบุผู้สั่งซื้อ') end
        else 'ทั้งหมด'
      end as group_label,
      p.line_gross_sat,
      p.line_net_sat,
      coalesce(lc.c_net_sat, 0) as c_net_sat,
      coalesce(lc.c_vat_sat, 0) as c_vat_sat
    from pop p
    left join public.purchase_orders    po   on po.id  = p.purchase_order_id
    left join public.suppliers          sup  on sup.id = coalesce(po.supplier_id, p.pr_supplier_id)
    left join public.projects           proj on proj.id = p.project_id
    left join public.catalog_items      ci   on ci.id  = p.catalog_item_id
    left join public.catalog_categories cat  on cat.id = ci.category_id
    left join public.users              usr  on usr.id = p.requested_by
    left join line_charge               lc   on lc.line_id = p.id
    where (p_project_id is null or p.project_id = p_project_id)
  )
  select
    e.bucket,
    e.group_key,
    e.group_label,
    (sum(e.line_gross_sat) / 100.0)::numeric                             as line_gross,
    (sum(e.c_net_sat + e.c_vat_sat) / 100.0)::numeric                    as charge_gross,
    (sum(e.line_gross_sat + e.c_net_sat + e.c_vat_sat) / 100.0)::numeric as gross,
    (sum(e.line_net_sat + e.c_net_sat) / 100.0)::numeric                 as net,
    (sum(e.line_gross_sat - e.line_net_sat + e.c_vat_sat) / 100.0)::numeric as vat,
    count(*)::int                                                        as pr_count
  from enriched e
  group by e.bucket, e.group_key, e.group_label
  order by e.bucket, e.group_label;
end;
$$;

revoke all on function public.purchase_report(date, date, text, text, uuid) from public, anon;
grant execute on function public.purchase_report(date, date, text, text, uuid) to authenticated;
