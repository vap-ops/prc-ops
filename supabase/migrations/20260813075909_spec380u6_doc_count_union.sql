-- Spec 380 U6 — make list_money_events_for_review.doc_count for
-- purchase_requests mean "accounting documents", and let an accounting waiver
-- discharge the ไม่มีเอกสาร tab.
--
-- Before this migration the purchase-request doc_count was:
--   (a) PURPOSE-BLIND — a reference photo or a delivery-confirmation snapshot
--       counted as an accounting document, so an order carrying only a photo
--       read as documented; and
--   (b) blind to every PO-level document — all 376 purchase_order_attachments
--       were invisible to it, because the subquery only ever looked at
--       purchase_request_attachments.
-- Measured on live data at write time (643 purchase requests): the ไม่มีเอกสาร
-- tab goes 620 → 356 rows — 269 orders leave (they always carried a PO
-- source_document the count could not see) and 5 ENTER (they carry only a
-- photo and were never documented).
--
-- Coverage follows spec §2/§3, whose SSOT on the app side is
-- src/lib/purchasing/doc-chase.ts (SATISFYING_DOC_TYPES). The class rule lives
-- here in ONE place — purchase_doc_satisfying_types — so the PR half and the PO
-- half cannot drift from each other.
--
-- (c) A THIRD defect, found while building: the old subquery's plain
--     not-pointed-at anti-join COUNTED TOMBSTONES. In these two tables a
--     delete is an INSERT of a payload-less row carrying superseded_by → the
--     row it retires (enforced by pra_tombstone_shape / poa_tombstone_shape:
--     `superseded_by is null OR storage_path is null`). Nothing points AT a
--     tombstone, so the anti-join kept it and a DELETED invoice still read as
--     a document — live, exactly that on purchase request
--     c7f61658-967d-4099-a9fd-639c46b5100e. The purchase_*_attachments_current
--     views encode the correct rule (`superseded_by is null AND not
--     pointed-at` — the tombstone fails the first arm, its target the second),
--     so this migration reads through them rather than re-deriving.

-- ---------------------------------------------------------------------------
-- The per-class satisfying-document rule (spec §2, RD-grounded).
-- A VAT-registered vendor's order is discharged ONLY by a full tax invoice
-- (ม.86/4 — the 7% input-VAT claim); everyone else by the fallback ladder.
-- p_is_vat IS NULL = no supplier row at all, the only reachable "unknown".
-- ---------------------------------------------------------------------------
create or replace function public.purchase_doc_satisfying_types(p_is_vat boolean)
returns public.purchase_doc_type[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_is_vat then array['tax_invoice_full']::public.purchase_doc_type[]
    else array[
      'tax_invoice_full', 'receipt_cash_bill', 'payment_voucher', 'cert_in_lieu'
    ]::public.purchase_doc_type[]
  end;
$$;

-- A new function is PUBLIC-EXECUTE by default here; take that back explicitly
-- rather than relying on the absence of a grant (house 336/372 pattern).
revoke all on function public.purchase_doc_satisfying_types(boolean) from public, anon;
grant execute on function public.purchase_doc_satisfying_types(boolean) to authenticated;

comment on function public.purchase_doc_satisfying_types(boolean) is
  'Spec 380 §2 — doc_type values that discharge an order of the given supplier class. '
  'Mirrors SATISFYING_DOC_TYPES in src/lib/purchasing/doc-chase.ts; both sides are '
  'pinned to the same literal table so a one-sided edit fails its suite.';

-- ---------------------------------------------------------------------------
-- Body reproduced verbatim from the live definition except:
--   1. the purchase_requests doc_count subquery (the §3 union, above);
--   2. a `wv` (waived) column carried through events → joined;
--   3. the no_docs tab arm, which now excludes waived orders.
-- ---------------------------------------------------------------------------
create or replace function public.list_money_events_for_review(
  p_tab text,
  p_project uuid default null::uuid,
  p_month date default null::date,
  p_limit integer default 50,
  p_offset integer default 0,
  p_source_table text default null::text,
  p_source_id uuid default null::uuid
)
returns table(
  source_table text, source_id uuid, project_id uuid, project_name text,
  amount numeric, event_date date, counterparty text, doc_count integer,
  review_status public.money_review_status, open_flag_count integer,
  docs_expected text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
  if p_tab not in ('pending', 'flagged', 'no_docs', 'verified', 'any') then
    raise exception 'list_money_events_for_review: unknown tab %', p_tab
      using errcode = '22023';
  end if;

  return query
  with events as (
    select 'purchase_requests'::text as src, pr.id as sid, pr.project_id as pid,
           coalesce(pr.amount, 0)::numeric as amt,
           coalesce(pr.purchased_at, pr.requested_at, pr.created_at)::date as ev_date,
           coalesce(s.name, pr.supplier, pr.item_description) as cp,
           -- Spec 380 §3 — an ACCOUNTING document, not any attachment: a typed
           -- doc that satisfies this supplier's class, or a legacy untyped
           -- upload on a qualifying purpose (covered-loose, §2 decision ②).
           -- PR-level and PO-level documents both discharge the order.
           ((select count(*)::int from public.purchase_request_attachments_current a
              where a.purchase_request_id = pr.id
                and ((a.doc_type is null and a.purpose::text in ('invoice', 'payment'))
                  or (a.doc_type is not null
                      and a.doc_type = any(public.purchase_doc_satisfying_types(s.is_vat_registered)))))
          + (select count(*)::int from public.purchase_order_attachments_current oa
              where oa.purchase_order_id = pr.purchase_order_id
                and ((oa.doc_type is null and oa.purpose::text = 'source_document')
                  or (oa.doc_type is not null
                      and oa.doc_type = any(public.purchase_doc_satisfying_types(s.is_vat_registered))))
            )) as dc,
           -- A waiver is NOT a document, so it never inflates dc (which is
           -- rendered and exported); it discharges the no_docs tab instead.
           exists (select 1 from public.purchase_doc_waivers w
                    where w.purchase_request_id = pr.id) as wv
      from public.purchase_requests pr
      left join public.suppliers s on s.id = pr.supplier_id
    union all
    select 'purchase_order_charges', poc.id, null::uuid, poc.amount,
           poc.created_at::date, coalesce(s2.name, po.supplier, 'PO ' || po.po_number::text), 0, false
      from public.purchase_order_charges poc
      join public.purchase_orders po on po.id = poc.purchase_order_id
      left join public.suppliers s2 on s2.id = po.supplier_id
    union all
    select 'office_expenses', oe.id, oe.project_id, oe.amount, oe.expense_date, oe.description,
           (select count(*)::int from public.office_expense_attachments a
             where a.office_expense_id = oe.id), false
      from public.office_expenses oe
    union all
    select 'stock_receipts', sr.id, sr.project_id,
           coalesce(sr.total_cost, sr.qty * sr.unit_cost), sr.received_at::date, s3.name, 0, false
      from public.stock_receipts sr
      left join public.suppliers s3 on s3.id = sr.supplier_id
    union all
    select 'stock_returns', st.id, st.project_id,
           coalesce(st.total_cost, st.qty * st.unit_cost), st.returned_at::date, ci.base_item, 0, false
      from public.stock_returns st
      left join public.catalog_items ci on ci.id = st.catalog_item_id
    union all
    select 'wage_payments', wp.id, null::uuid, wp.paid_amount, wp.paid_at, w.name, 0, false
      from public.wage_payments wp
      join public.workers w on w.id = wp.worker_id
     where not exists (select 1 from public.wage_payments nw where nw.superseded_by = wp.id)
    union all
    select 'wp_labor_costs', wlc.work_package_id, wpk.project_id,
           wlc.own_cost + wlc.dc_cost, wlc.computed_at::date, wpk.name, 0, false
      from public.wp_labor_costs wlc
      join public.work_packages wpk on wpk.id = wlc.work_package_id
    union all
    select 'equipment_rental_batches', erb.id, null::uuid, erb.monthly_rate, erb.starts_on,
           eo.name, 0, false
      from public.equipment_rental_batches erb
      left join public.equipment_owners eo on eo.id = erb.owner_id
    union all
    select 'rental_charges', rc.id, null::uuid, rc.amount, rc.created_at::date, eo2.name, 0, false
      from public.rental_charges rc
      join public.equipment_rental_batches erb2 on erb2.id = rc.rental_batch_id
      left join public.equipment_owners eo2 on eo2.id = erb2.owner_id
    union all
    select 'rental_settlements', rs.id, null::uuid, rs.net_amount,
           coalesce(rs.invoice_date, rs.created_at::date), eo3.name,
           (select count(*)::int from public.rental_settlement_attachments a
             where a.settlement_id = rs.id), false
      from public.rental_settlements rs
      join public.equipment_rental_batches erb3 on erb3.id = rs.agreement_id
      left join public.equipment_owners eo3 on eo3.id = erb3.owner_id
     where not exists (select 1 from public.rental_settlements nr where nr.superseded_by = rs.id)
    union all
    select 'subcontract_payments', sp.id, sc.project_id, sp.amount, sp.paid_date,
           coalesce(con.name, sc.title), 0, false
      from public.subcontract_payments sp
      join public.subcontracts sc on sc.id = sp.subcontract_id
      left join public.contractors con on con.id = sc.contractor_id
     where not exists (select 1 from public.subcontract_payments np where np.superseded_by = sp.id)
    union all
    select 'client_billings', cb.id, cb.project_id, cb.gross_amount,
           coalesce(cb.certified_at::date, cb.created_at::date), null::text, 0, false
      from public.client_billings cb
    union all
    -- received_date is nullable — coalesce like the siblings, or a null-dated
    -- receipt vanishes from every month-filtered tab of an audit queue.
    select 'client_receipts', cr.id, cr.project_id, cr.amount,
           coalesce(cr.received_date, cr.created_at::date), null::text, 0, false
      from public.client_receipts cr
     where not exists (select 1 from public.client_receipts nc where nc.superseded_by = cr.id)
    union all
    select 'retention_receivables', rr.id, rr.project_id, rr.amount_withheld,
           coalesce(rr.due_date, rr.created_at::date), null::text, 0, false
      from public.retention_receivables rr
    union all
    select 'wht_certificates', wc.id, null::uuid, wc.wht_amount, wc.issued_date,
           coalesce(s4.name, con2.name, wc.tax_id_13), 0, false
      from public.wht_certificates wc
      left join public.suppliers s4 on s4.id = wc.supplier_id
      left join public.contractors con2 on con2.id = wc.contractor_id
  ),
  joined as (
    select e.src, e.sid, e.pid, p.name as pname, e.amt, e.ev_date, e.cp, e.dc, e.wv,
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
   where (p_source_table is null or j.src = p_source_table)
     and (p_source_id is null or j.sid = p_source_id)
     and (p_project is null or j.pid = p_project)
     and (p_month is null or date_trunc('month', j.ev_date::timestamp) = date_trunc('month', p_month::timestamp))
     and case p_tab
           when 'any' then true
           when 'pending' then j.rstatus = 'pending'
           when 'flagged' then j.rstatus = 'flagged'
           when 'verified' then j.rstatus = 'verified'
           -- Spec 380 §3 counts an accounting waiver as coverage. Without this
           -- arm a waived dead-end order would sit in the ไม่มีเอกสาร tab
           -- forever and the waiver would be inert in its own queue.
           else j.dexp = 'expected' and j.dc = 0 and not j.wv
         end
   order by (j.rstatus = 'flagged') desc, j.ev_date asc nulls last, j.amt desc nulls last
   limit v_limit offset v_offset;
end;
$function$;
