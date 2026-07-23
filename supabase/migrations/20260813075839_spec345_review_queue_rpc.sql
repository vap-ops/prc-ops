-- Spec 345 U2 — the money-event review queue read path.
-- money_review_docs_expected: the docs-expected SSOT (pinned by pgTAP; the TS
-- view layer maps classes to copy and never re-derives membership).
-- list_money_events_for_review: SECURITY DEFINER union over the 15 allowlisted
-- sources LEFT JOIN money_event_reviews (absent row = pending), gated
-- accounting + super_admin. Runs on the AUTHENTICATED session — the gate reads
-- the caller's role. Supersede-corrected sources contribute only their CURRENT
-- rows (ADR 0009 anti-join); the superseded row leaves the queue with its
-- review already staled by the U1 trigger.

create function public.money_review_docs_expected(p_source text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  v := case p_source
    when 'purchase_requests' then 'expected'
    when 'office_expenses' then 'expected'
    when 'rental_settlements' then 'expected'
    when 'wp_labor_costs' then 'not_expected'
    when 'purchase_order_charges' then 'no_path_yet'
    when 'stock_receipts' then 'no_path_yet'
    when 'stock_returns' then 'no_path_yet'
    when 'wage_payments' then 'no_path_yet'
    when 'equipment_rental_batches' then 'no_path_yet'
    when 'rental_charges' then 'no_path_yet'
    when 'subcontract_payments' then 'no_path_yet'
    when 'client_billings' then 'no_path_yet'
    when 'client_receipts' then 'no_path_yet'
    when 'retention_receivables' then 'no_path_yet'
    when 'wht_certificates' then 'no_path_yet'
  end;
  if v is null then
    raise exception 'money_review_docs_expected: unknown source %', p_source
      using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public.money_review_docs_expected(text) from public, anon, authenticated;

create function public.list_money_events_for_review(
  p_tab text,
  p_project uuid default null,
  p_month date default null,
  p_limit int default 50,
  p_offset int default 0)
returns table (
  source_table text,
  source_id uuid,
  project_id uuid,
  project_name text,
  amount numeric,
  event_date date,
  counterparty text,
  doc_count int,
  review_status public.money_review_status,
  open_flag_count int,
  docs_expected text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- current_user_role() returns the user_role ENUM — cast BEFORE coalescing,
  -- or a null-role caller (anon/service) dies 22P02 instead of hitting the gate
  -- (the rls-self-check-coalesce trap).
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if v_role not in ('accounting', 'super_admin') then
    raise exception 'list_money_events_for_review: role not permitted'
      using errcode = '42501';
  end if;
  if p_tab not in ('pending', 'flagged', 'no_docs', 'verified') then
    raise exception 'list_money_events_for_review: unknown tab %', p_tab
      using errcode = '22023';
  end if;

  return query
  with events as (
    select 'purchase_requests'::text as src, pr.id as sid, pr.project_id as pid,
           coalesce(pr.amount, 0)::numeric as amt,
           coalesce(pr.purchased_at, pr.requested_at, pr.created_at)::date as ev_date,
           coalesce(s.name, pr.supplier, pr.item_description) as cp,
           (select count(*)::int from public.purchase_request_attachments a
             where a.purchase_request_id = pr.id
               and not exists (select 1 from public.purchase_request_attachments b
                                where b.superseded_by = a.id)) as dc
      from public.purchase_requests pr
      left join public.suppliers s on s.id = pr.supplier_id
    union all
    select 'purchase_order_charges', poc.id, null::uuid, poc.amount,
           poc.created_at::date, coalesce(s2.name, po.supplier, 'PO ' || po.po_number::text), 0
      from public.purchase_order_charges poc
      join public.purchase_orders po on po.id = poc.purchase_order_id
      left join public.suppliers s2 on s2.id = po.supplier_id
    union all
    select 'office_expenses', oe.id, oe.project_id, oe.amount, oe.expense_date, oe.description,
           (select count(*)::int from public.office_expense_attachments a
             where a.office_expense_id = oe.id)
      from public.office_expenses oe
    union all
    select 'stock_receipts', sr.id, sr.project_id,
           coalesce(sr.total_cost, sr.qty * sr.unit_cost), sr.received_at::date, s3.name, 0
      from public.stock_receipts sr
      left join public.suppliers s3 on s3.id = sr.supplier_id
    union all
    select 'stock_returns', st.id, st.project_id,
           coalesce(st.total_cost, st.qty * st.unit_cost), st.returned_at::date, ci.base_item, 0
      from public.stock_returns st
      left join public.catalog_items ci on ci.id = st.catalog_item_id
    union all
    select 'wage_payments', wp.id, null::uuid, wp.paid_amount, wp.paid_at, w.name, 0
      from public.wage_payments wp
      join public.workers w on w.id = wp.worker_id
     where not exists (select 1 from public.wage_payments nw where nw.superseded_by = wp.id)
    union all
    select 'wp_labor_costs', wlc.work_package_id, wpk.project_id,
           wlc.own_cost + wlc.dc_cost, wlc.computed_at::date, wpk.name, 0
      from public.wp_labor_costs wlc
      join public.work_packages wpk on wpk.id = wlc.work_package_id
    union all
    select 'equipment_rental_batches', erb.id, null::uuid, erb.monthly_rate, erb.starts_on,
           eo.name, 0
      from public.equipment_rental_batches erb
      left join public.equipment_owners eo on eo.id = erb.owner_id
    union all
    select 'rental_charges', rc.id, null::uuid, rc.amount, rc.created_at::date, eo2.name, 0
      from public.rental_charges rc
      join public.equipment_rental_batches erb2 on erb2.id = rc.rental_batch_id
      left join public.equipment_owners eo2 on eo2.id = erb2.owner_id
    union all
    select 'rental_settlements', rs.id, null::uuid, rs.net_amount,
           coalesce(rs.invoice_date, rs.created_at::date), eo3.name,
           (select count(*)::int from public.rental_settlement_attachments a
             where a.settlement_id = rs.id)
      from public.rental_settlements rs
      join public.equipment_rental_batches erb3 on erb3.id = rs.agreement_id
      left join public.equipment_owners eo3 on eo3.id = erb3.owner_id
     where not exists (select 1 from public.rental_settlements nr where nr.superseded_by = rs.id)
    union all
    select 'subcontract_payments', sp.id, sc.project_id, sp.amount, sp.paid_date,
           coalesce(con.name, sc.title), 0
      from public.subcontract_payments sp
      join public.subcontracts sc on sc.id = sp.subcontract_id
      left join public.contractors con on con.id = sc.contractor_id
     where not exists (select 1 from public.subcontract_payments np where np.superseded_by = sp.id)
    union all
    select 'client_billings', cb.id, cb.project_id, cb.gross_amount,
           coalesce(cb.certified_at::date, cb.created_at::date), null::text, 0
      from public.client_billings cb
    union all
    select 'client_receipts', cr.id, cr.project_id, cr.amount, cr.received_date, null::text, 0
      from public.client_receipts cr
     where not exists (select 1 from public.client_receipts nc where nc.superseded_by = cr.id)
    union all
    select 'retention_receivables', rr.id, rr.project_id, rr.amount_withheld,
           coalesce(rr.due_date, rr.created_at::date), null::text, 0
      from public.retention_receivables rr
    union all
    select 'wht_certificates', wc.id, null::uuid, wc.wht_amount, wc.issued_date,
           coalesce(s4.name, con2.name, wc.tax_id_13), 0
      from public.wht_certificates wc
      left join public.suppliers s4 on s4.id = wc.supplier_id
      left join public.contractors con2 on con2.id = wc.contractor_id
  ),
  joined as (
    select e.src, e.sid, e.pid, p.name as pname, e.amt, e.ev_date, e.cp, e.dc,
           coalesce(r.status, 'pending'::public.money_review_status) as rstatus,
           coalesce((select count(*)::int from public.money_review_flags f
                      where f.review_id = r.id and f.status = 'open'), 0) as ofc,
           public.money_review_docs_expected(e.src) as dexp
      from events e
      left join public.projects p on p.id = e.pid
      left join public.money_event_reviews r
        on r.source_table = e.src and r.source_id = e.sid
  )
  select j.src, j.sid, j.pid, j.pname, j.amt, j.ev_date, j.cp, j.dc, j.rstatus, j.ofc, j.dexp
    from joined j
   where (p_project is null or j.pid = p_project)
     and (p_month is null or date_trunc('month', j.ev_date::timestamp) = date_trunc('month', p_month::timestamp))
     and case p_tab
           when 'pending' then j.rstatus = 'pending'
           when 'flagged' then j.rstatus = 'flagged'
           when 'verified' then j.rstatus = 'verified'
           else j.dexp = 'expected' and j.dc = 0
         end
   order by (j.rstatus = 'flagged') desc, j.ev_date asc nulls last, j.amt desc nulls last
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.list_money_events_for_review(text, uuid, date, int, int)
  from public, anon;
grant execute on function public.list_money_events_for_review(text, uuid, date, int, int)
  to authenticated;
