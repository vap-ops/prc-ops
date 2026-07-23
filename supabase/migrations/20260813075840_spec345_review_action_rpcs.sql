-- Spec 345 U3 — the review action RPCs (verify / flag / resolve / dismiss), the
-- status-recompute helper, and the single-row read path (the list RPC regains
-- signature: + p_source_table/p_source_id filters and the 'any' tab, so the U3
-- voucher reads through the SAME union body — no second source-of-truth).
-- All writes to the sealed review tables happen HERE, under the caller's real
-- role (MONEY_REVIEW_ROLES = accounting + super_admin at the DB gate). Every
-- action writes audit_log action='other' + payload->>'event' (lane-344
-- convention). U2 lessons applied: current_user_role() casts ::text BEFORE
-- coalesce; revokes name only public+anon (authenticated re-grants by default
-- privilege and the fns gate internally).

-- ---------------------------------------------------------------------------
-- 1. Status recompute — the ONE place the flags→status rule lives (plan §U3):
--    any OPEN flag ⇒ flagged; else a verified review stays verified; else
--    pending. Never silently promotes to verified — only verify_money_event
--    does that.
-- ---------------------------------------------------------------------------
create function public.money_review_recompute(p_review_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.money_event_reviews r
     set status = case
       when exists (select 1 from public.money_review_flags f
                     where f.review_id = r.id and f.status = 'open') then 'flagged'
       when r.status = 'verified' then 'verified'
       else 'pending'
     end::public.money_review_status
   where r.id = p_review_id;
$$;

revoke all on function public.money_review_recompute(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. verify_money_event — creates the review on first admin action; refuses
--    while an OPEN flag exists; dismisses outstanding SUGGESTED system flags
--    (plan D-1: changed_after_verified is information for the re-verifier, not
--    a route-to-uploader item).
-- ---------------------------------------------------------------------------
create function public.verify_money_event(
  p_source_table text,
  p_source_id uuid,
  p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_review public.money_event_reviews;
begin
  if v_role not in ('accounting', 'super_admin') then
    raise exception 'verify_money_event: role not permitted' using errcode = '42501';
  end if;
  -- Validates the source table too (raises 22023 on anything off-allowlist).
  perform public.money_review_docs_expected(p_source_table);
  if p_source_id is null then
    raise exception 'verify_money_event: source id required' using errcode = '22023';
  end if;

  insert into public.money_event_reviews (source_table, source_id)
  values (p_source_table, p_source_id)
  on conflict (source_table, source_id) do nothing;

  select * into v_review from public.money_event_reviews
   where source_table = p_source_table and source_id = p_source_id
   for update;

  if exists (select 1 from public.money_review_flags f
              where f.review_id = v_review.id and f.status = 'open') then
    raise exception 'verify_money_event: resolve open flags first' using errcode = 'P0001';
  end if;

  update public.money_review_flags
     set status = 'dismissed',
         resolved_by = auth.uid(),
         resolved_at = now(),
         resolution = 'ยกเลิกอัตโนมัติเมื่อตรวจผ่าน'
   where review_id = v_review.id and status = 'suggested';

  update public.money_event_reviews
     set status = 'verified',
         verified_by = auth.uid(),
         verified_at = now(),
         verified_via = 'reviewer',
         note = coalesce(p_note, note)
   where id = v_review.id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'other', p_source_table, p_source_id,
    jsonb_build_object('event', 'money_review_verified',
                       'review_id', v_review.id, 'note', p_note));
end;
$$;

revoke all on function public.verify_money_event(text, uuid, text) from public, anon;
grant execute on function public.verify_money_event(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. flag_money_event — an open reviewer flag; the review shows flagged.
--    changed_after_verified is reserved for the U1 trigger; an 'other' flag
--    must say why.
-- ---------------------------------------------------------------------------
create function public.flag_money_event(
  p_source_table text,
  p_source_id uuid,
  p_flag_type public.money_flag_type,
  p_detail text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_review_id uuid;
  v_flag_id uuid;
begin
  if v_role not in ('accounting', 'super_admin') then
    raise exception 'flag_money_event: role not permitted' using errcode = '42501';
  end if;
  perform public.money_review_docs_expected(p_source_table);
  if p_source_id is null then
    raise exception 'flag_money_event: source id required' using errcode = '22023';
  end if;
  if p_flag_type = 'changed_after_verified' then
    raise exception 'flag_money_event: changed_after_verified is system-reserved'
      using errcode = '22023';
  end if;
  if p_flag_type = 'other' and nullif(btrim(coalesce(p_detail, '')), '') is null then
    raise exception 'flag_money_event: detail required for other' using errcode = '22023';
  end if;

  insert into public.money_event_reviews (source_table, source_id)
  values (p_source_table, p_source_id)
  on conflict (source_table, source_id) do nothing;

  select id into v_review_id from public.money_event_reviews
   where source_table = p_source_table and source_id = p_source_id
   for update;

  insert into public.money_review_flags
    (review_id, flag_type, raised_by_kind, status, detail, flagged_by)
  values
    (v_review_id, p_flag_type, 'reviewer', 'open', p_detail, auth.uid())
  returning id into v_flag_id;

  update public.money_event_reviews set status = 'flagged' where id = v_review_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'other', p_source_table, p_source_id,
    jsonb_build_object('event', 'money_review_flag_raised',
                       'review_id', v_review_id, 'flag_id', v_flag_id,
                       'flag_type', p_flag_type, 'detail', p_detail));

  return v_flag_id;
end;
$$;

revoke all on function public.flag_money_event(text, uuid, public.money_flag_type, text)
  from public, anon;
grant execute on function public.flag_money_event(text, uuid, public.money_flag_type, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. resolve_money_flag — U3 ships the ADMIN side (U5 widens the gate to the
--    uploader with a self-or-owner arm). Resolution text is REQUIRED: the
--    resolver says what happened.
-- ---------------------------------------------------------------------------
create function public.resolve_money_flag(
  p_flag_id uuid,
  p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_flag public.money_review_flags;
  v_review public.money_event_reviews;
begin
  if v_role not in ('accounting', 'super_admin') then
    raise exception 'resolve_money_flag: role not permitted' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_resolution, '')), '') is null then
    raise exception 'resolve_money_flag: resolution required' using errcode = '22023';
  end if;

  select * into v_flag from public.money_review_flags where id = p_flag_id for update;
  if v_flag.id is null then
    raise exception 'resolve_money_flag: flag not found' using errcode = '22023';
  end if;
  if v_flag.status <> 'open' then
    raise exception 'resolve_money_flag: flag is not open' using errcode = 'P0001';
  end if;
  select * into v_review from public.money_event_reviews where id = v_flag.review_id;

  update public.money_review_flags
     set status = 'resolved',
         resolved_by = auth.uid(),
         resolved_at = now(),
         resolution = p_resolution
   where id = p_flag_id;

  perform public.money_review_recompute(v_flag.review_id);

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'other', v_review.source_table, v_review.source_id,
    jsonb_build_object('event', 'money_review_flag_resolved',
                       'review_id', v_flag.review_id, 'flag_id', p_flag_id,
                       'flag_type', v_flag.flag_type, 'resolution', p_resolution));
end;
$$;

revoke all on function public.resolve_money_flag(uuid, text) from public, anon;
grant execute on function public.resolve_money_flag(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. dismiss_money_flag — closes an open OR suggested flag as not-a-problem.
-- ---------------------------------------------------------------------------
create function public.dismiss_money_flag(
  p_flag_id uuid,
  p_resolution text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_flag public.money_review_flags;
  v_review public.money_event_reviews;
begin
  if v_role not in ('accounting', 'super_admin') then
    raise exception 'dismiss_money_flag: role not permitted' using errcode = '42501';
  end if;

  select * into v_flag from public.money_review_flags where id = p_flag_id for update;
  if v_flag.id is null then
    raise exception 'dismiss_money_flag: flag not found' using errcode = '22023';
  end if;
  if v_flag.status not in ('open', 'suggested') then
    raise exception 'dismiss_money_flag: flag is not open' using errcode = 'P0001';
  end if;
  select * into v_review from public.money_event_reviews where id = v_flag.review_id;

  update public.money_review_flags
     set status = 'dismissed',
         resolved_by = auth.uid(),
         resolved_at = now(),
         resolution = coalesce(nullif(btrim(coalesce(p_resolution, '')), ''), 'ปัดตก')
   where id = p_flag_id;

  perform public.money_review_recompute(v_flag.review_id);

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'other', v_review.source_table, v_review.source_id,
    jsonb_build_object('event', 'money_review_flag_dismissed',
                       'review_id', v_flag.review_id, 'flag_id', p_flag_id,
                       'flag_type', v_flag.flag_type, 'resolution', p_resolution));
end;
$$;

revoke all on function public.dismiss_money_flag(uuid, text) from public, anon;
grant execute on function public.dismiss_money_flag(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The list RPC regains signature: + p_source_table / p_source_id (the U3
--    voucher's single-row read) and tab 'any' (no status filter — a voucher
--    must find its row whatever state it is in). Same body otherwise; the old
--    5-arg signature is dropped (its only caller, /accounting/review, moves to
--    named args that omit the new params).
-- ---------------------------------------------------------------------------
drop function public.list_money_events_for_review(text, uuid, date, int, int);

create function public.list_money_events_for_review(
  p_tab text,
  p_project uuid default null,
  p_month date default null,
  p_limit int default 50,
  p_offset int default 0,
  p_source_table text default null,
  p_source_id uuid default null)
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
    -- received_date is nullable — coalesce like the siblings, or a null-dated
    -- receipt vanishes from every month-filtered tab of an audit queue.
    select 'client_receipts', cr.id, cr.project_id, cr.amount,
           coalesce(cr.received_date, cr.created_at::date), null::text, 0
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
   where (p_source_table is null or j.src = p_source_table)
     and (p_source_id is null or j.sid = p_source_id)
     and (p_project is null or j.pid = p_project)
     and (p_month is null or date_trunc('month', j.ev_date::timestamp) = date_trunc('month', p_month::timestamp))
     and case p_tab
           when 'any' then true
           when 'pending' then j.rstatus = 'pending'
           when 'flagged' then j.rstatus = 'flagged'
           when 'verified' then j.rstatus = 'verified'
           else j.dexp = 'expected' and j.dc = 0
         end
   order by (j.rstatus = 'flagged') desc, j.ev_date asc nulls last, j.amt desc nulls last
   limit v_limit offset v_offset;
end;
$$;

revoke all on function public.list_money_events_for_review(text, uuid, date, int, int, text, uuid)
  from public, anon;
grant execute on function public.list_money_events_for_review(text, uuid, date, int, int, text, uuid)
  to authenticated;
