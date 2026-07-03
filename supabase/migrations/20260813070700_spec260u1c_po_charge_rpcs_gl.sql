-- Spec 260 U1c — the write + GL layer for PO-level charges:
--   1. add_purchase_order_charge  — the create-gate RPC (records one charge)
--   2. void_purchase_order_charge — the manager-gate RPC (un-books one charge)
--   3. post_purchase_order_charge_to_gl — the internal poster (the entry)
--   4. drain_gl_posting — re-sourced from LIVE + the new CASE arm
--   5. void_purchase_order — re-sourced from LIVE + charge reverse/skip
--
-- GL policy (ADR 0057 direct-posting, the spec-251 precedent): one journal
-- entry per charge, through the async outbox. The Dr side (transport/other) —
-- or Cr side (discount contra) — is allocated PROPORTIONALLY over the PO's
-- member lines by line net: WP-bound share → Dr 1400 WIP (project + WP),
-- store-bound share → Dr 1500 Inventory (project only — journal_lines has NO
-- store/BU dimension column, matching post_stock_receipt_to_gl). Input VAT →
-- 1300; AP → 2100 (supplier). Discount reverses every side (the contra).

-- ===========================================================================
-- 1. add_purchase_order_charge — create gate (ADR 0044 §4 + ADR 0058: PD in).
--    Whoever bundles the PO records its charges. No state guard beyond PO
--    existence — late carrier invoices arrive any time before void. amount>0
--    and 'other'-needs-note are enforced by the table CHECKs (→ 23514), not
--    re-checked here. The AFTER-INSERT trigger enqueues the GL posting job.
-- ===========================================================================
create function public.add_purchase_order_charge(
  p_po_id       uuid,
  p_charge_type public.po_charge_type,
  p_amount      numeric,
  p_vat_rate    numeric,
  p_note        text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_number bigint;
  v_charge_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role()
          not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'add_purchase_order_charge: role not permitted'
      using errcode = '42501';
  end if;

  select po_number into v_po_number
    from public.purchase_orders where id = p_po_id;
  if v_po_number is null then
    raise exception 'add_purchase_order_charge: purchase order not found'
      using errcode = 'P0001';
  end if;

  -- The table CHECKs enforce amount>0 (23514) and the 'other'-needs-note rule
  -- (a whitespace-only note collapses to NULL here → the CHECK fires 23514).
  insert into public.purchase_order_charges
    (purchase_order_id, charge_type, amount, vat_rate, note, created_by)
  values
    (p_po_id, p_charge_type, p_amount, coalesce(p_vat_rate, 0),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_charge_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'po_charge_add', 'purchase_order_charges', v_charge_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'charge_type', p_charge_type,
       'amount',      p_amount));

  return v_charge_id;
end;
$$;

revoke all on function public.add_purchase_order_charge(uuid, public.po_charge_type, numeric, numeric, text)
  from public, anon;
grant execute on function public.add_purchase_order_charge(uuid, public.po_charge_type, numeric, numeric, text)
  to authenticated;

-- ===========================================================================
-- 2. void_purchase_order_charge — manager gate (is_manager = PM/super/PD).
--    Adding a charge is routine data entry; removing one un-books recorded
--    money, so it is the manager-only class (the operator's rule). Spec 261
--    widens this to procurement_manager when that role lands. GL safety mirrors
--    void_purchase_order (spec 259): reverse a posted entry, or skip a
--    still-pending job (mutually exclusive per charge) — then DELETE the row.
-- ===========================================================================
create function public.void_purchase_order_charge(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge    public.purchase_order_charges%rowtype;
  v_po_number bigint;
  v_old_entry uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'void_purchase_order_charge: role not permitted'
      using errcode = '42501';
  end if;

  select * into v_charge
    from public.purchase_order_charges where id = p_charge_id;
  if not found then
    raise exception 'void_purchase_order_charge: charge not found'
      using errcode = 'P0001';
  end if;

  select po_number into v_po_number
    from public.purchase_orders where id = v_charge.purchase_order_id;

  -- reverse_journal_internal takes an ENTRY id — look the posted, not-yet-
  -- reversed entry up by (source_table, source_id, source_event) first.
  select e.id into v_old_entry
    from public.journal_entries e
   where e.source_table = 'purchase_order_charges'
     and e.source_id    = p_charge_id
     and e.source_event = 'po_charge'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old_entry is not null then
    perform public.reverse_journal_internal(
      v_old_entry, auth.uid(), 'void: PO charge removed');
  end if;

  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'purchase_order_charges'
     and source_id    = p_charge_id
     and source_event = 'po_charge'
     and status in ('pending', 'posting');

  -- Audit BEFORE the delete (the payload captures the row about to vanish).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'po_charge_void', 'purchase_order_charges', p_charge_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'charge_type', v_charge.charge_type,
       'amount',      v_charge.amount));

  delete from public.purchase_order_charges where id = p_charge_id;
end;
$$;

revoke all on function public.void_purchase_order_charge(uuid) from public, anon;
grant execute on function public.void_purchase_order_charge(uuid) to authenticated;

-- ===========================================================================
-- 3. post_purchase_order_charge_to_gl(charge_id) — the internal poster. NOT a
--    human RPC: revoked from authenticated; the drain (SECURITY DEFINER, runs
--    as owner) is the only caller. Builds the balanced entry with proportional
--    allocation + exact-sum rounding (remainder to the largest share, the
--    split_purchase_request_on_receipt discipline).
-- ===========================================================================
create function public.post_purchase_order_charge_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge    public.purchase_order_charges%rowtype;
  v_supplier  uuid;
  v_actor     uuid;
  v_at        date;
  v_gross     numeric(14, 2);
  v_net       numeric(14, 2);
  v_vat       numeric(14, 2);
  v_rate      numeric;
  v_lines     jsonb;
begin
  select * into v_charge
    from public.purchase_order_charges where id = p_source_id;
  if not found then
    raise exception 'post_purchase_order_charge_to_gl: charge not found'
      using errcode = 'P0001';
  end if;

  v_gross := v_charge.amount;
  v_rate  := coalesce(v_charge.vat_rate, 0);
  v_actor := v_charge.created_by;
  v_at    := v_charge.created_at::date;

  select supplier_id into v_supplier
    from public.purchase_orders where id = v_charge.purchase_order_id;

  -- Net / VAT from gross + rate (ADR 0045), rounded to 2dp; net + VAT = gross.
  if v_rate <= 0 then
    v_net := v_gross;
    v_vat := 0;
  else
    v_net := round(v_gross / (1 + v_rate / 100), 2);
    v_vat := v_gross - v_net;
  end if;

  -- Allocate v_net AND v_vat over the active member lines by line net, each
  -- with an EXACT-SUM largest-remainder (Hamilton) split: floor every share to a
  -- satang, then hand the leftover satang one at a time to the largest fractional
  -- remainders. This guarantees each share is NON-NEGATIVE (a naive
  -- round-then-dump-the-remainder-on-one-share drives a share below zero when
  -- every share rounds up — post_journal_internal then rejects the negative
  -- one-sided leg and the charge silently never posts) while the shares still sum
  -- EXACTLY. Each member emits its OWN cost leg — WP-bound → 1400 (project + WP),
  -- store-bound → 1500 (project only, no store/BU dimension on journal_lines) —
  -- AND its own 1300 VAT leg tagged with that member's project (so a PO whose
  -- members span >1 project attributes VAT faithfully, not all to one project).
  -- A discount makes every leg a CREDIT (the contra); zero shares drop out
  -- (post_journal_internal requires one-sided lines).
  with members as (
    select pr.id,
           pr.work_package_id                          as wp,
           coalesce(wp.project_id, pr.project_id)      as project_id,
           (pr.amount / (1 + coalesce(pr.vat_rate, 0) / 100.0)) as w
      from public.purchase_requests pr
      left join public.work_packages wp on wp.id = pr.work_package_id
     where pr.purchase_order_id = v_charge.purchase_order_id
       and pr.status not in ('rejected', 'cancelled')
       and pr.amount is not null
  ),
  tot as (
    select coalesce(sum(w), 0) as total_w, count(*) as n from members
  ),
  ideal as (
    select m.id, m.wp, m.project_id, m.w,
           case when t.total_w > 0 then round(v_net * 100) * m.w / t.total_w
                else round(v_net * 100)::numeric / t.n end as net_ideal,
           case when t.total_w > 0 then round(v_vat * 100) * m.w / t.total_w
                else round(v_vat * 100)::numeric / t.n end as vat_ideal
      from members m cross join tot t
  ),
  floored as (
    select id, wp, project_id, w,
           floor(net_ideal) as net_fl, net_ideal - floor(net_ideal) as net_frac,
           floor(vat_ideal) as vat_fl, vat_ideal - floor(vat_ideal) as vat_frac
      from ideal
  ),
  ranked as (
    select f.*,
           round(v_net * 100) - sum(net_fl) over ()          as net_left,
           round(v_vat * 100) - sum(vat_fl) over ()          as vat_left,
           row_number() over (order by net_frac desc, w desc, id) as net_rank,
           row_number() over (order by vat_frac desc, w desc, id) as vat_rank
      from floored f
  ),
  final as (
    select id, wp, project_id,
           (net_fl + case when net_rank <= net_left then 1 else 0 end) / 100.0 as net_share,
           (vat_fl + case when vat_rank <= vat_left then 1 else 0 end) / 100.0 as vat_share
      from ranked
  )
  select coalesce(jsonb_agg(leg order by ord, id), '[]'::jsonb)
    into v_lines
    from (
      -- Cost leg per member (net share): WP-bound → 1400, store-bound → 1500.
      select 1 as ord, f.id,
             case when v_charge.charge_type = 'discount' then
               jsonb_build_object('account_code', case when f.wp is not null then '1400' else '1500' end,
                                  'credit', f.net_share, 'project_id', f.project_id, 'work_package_id', f.wp)
             else
               jsonb_build_object('account_code', case when f.wp is not null then '1400' else '1500' end,
                                  'debit', f.net_share, 'project_id', f.project_id, 'work_package_id', f.wp)
             end as leg
        from final f
       where f.net_share <> 0
      union all
      -- Input VAT leg per member (vat share), tagged with the member's project.
      select 2 as ord, f.id,
             case when v_charge.charge_type = 'discount' then
               jsonb_build_object('account_code', '1300', 'credit', f.vat_share, 'project_id', f.project_id)
             else
               jsonb_build_object('account_code', '1300', 'debit', f.vat_share, 'project_id', f.project_id)
             end
        from final f
       where f.vat_share <> 0
    ) legs;

  if v_lines = '[]'::jsonb then
    raise exception 'post_purchase_order_charge_to_gl: no allocable member lines'
      using errcode = 'P0001';
  end if;

  -- AP (2100), gross, supplier-dimensioned — Cr for transport/other (we owe the
  -- supplier more), Dr for a discount (the gross comes OFF what we owe).
  if v_charge.charge_type = 'discount' then
    v_lines := v_lines || jsonb_build_object('account_code', '2100', 'debit', v_gross,
                            'supplier_id', v_supplier);
  else
    v_lines := v_lines || jsonb_build_object('account_code', '2100', 'credit', v_gross,
                            'supplier_id', v_supplier);
  end if;

  return public.post_journal_internal(
    v_at, 'purchase_order_charges', p_source_id, 'po_charge',
    'PO charge: ' || v_charge.charge_type::text, v_lines, null, v_actor);
end;
$$;

revoke all on function public.post_purchase_order_charge_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_purchase_order_charge_to_gl(uuid) to service_role;

-- ===========================================================================
-- 4. drain_gl_posting — re-sourced VERBATIM from the LIVE proc
--    (pg_get_functiondef, 2026-07-04) + the new 'purchase_order_charges' CASE
--    arm. CREATE OR REPLACE (signature unchanged) preserves the grants + the
--    pg_cron schedule; the GL-drain re-source lesson (memory
--    gl-posting-drain-unscheduled) applies — every existing arm reproduced, the
--    pgTAP `like all(...)` pin fails the build if any arm is ever dropped.
-- ===========================================================================
create or replace function public.drain_gl_posting(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job   public.gl_posting_outbox;
  v_entry uuid;
  v_done  integer := 0;
begin
  for v_job in
    select * from public.gl_posting_outbox
     where status = 'pending'
     order by created_at
     limit greatest(p_limit, 0)
  loop
    begin
      case v_job.source_table
        when 'purchase_requests'        then v_entry := public.post_purchase_to_gl(v_job.source_id);
        when 'dc_payments'              then v_entry := public.post_dc_payment_to_gl(v_job.source_id);
        when 'wp_labor_costs'           then v_entry := public.post_labor_freeze_to_gl(v_job.source_id);
        when 'equipment_rental_batches' then v_entry := public.post_rental_batch_to_gl(v_job.source_id);
        when 'client_billings'          then v_entry := public.post_client_billing_to_gl(v_job.source_id);
        when 'retention_receivables'    then v_entry := public.post_retention_release_to_gl(v_job.source_id);
        when 'wht_certificates'         then v_entry := public.post_wht_certificate_to_gl(v_job.source_id);
        when 'client_receipts'          then v_entry := public.post_client_receipt_to_gl(v_job.source_id);
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        when 'stock_returns'            then v_entry := public.post_stock_return_to_gl(v_job.source_id);
        when 'stock_counts'             then v_entry := public.post_stock_count_to_gl(v_job.source_id);
        when 'stock_reversals'          then v_entry := public.post_stock_reversal_to_gl(v_job.source_id);
        -- Subcontract payments (spec 251) — direct Dr WIP 1400 / Cr Bank 1110,
        -- no accrual step.
        when 'subcontract_payments'     then v_entry := public.post_subcontract_payment_to_gl(v_job.source_id);
        -- PO-level charges (spec 260) — allocated Dr WIP 1400 / Dr Inventory
        -- 1500 (+ Dr 1300 VAT) / Cr AP 2100; a discount reverses every side.
        when 'purchase_order_charges'   then v_entry := public.post_purchase_order_charge_to_gl(v_job.source_id);
        else
          update public.gl_posting_outbox
             set status = 'skipped', last_error = 'unknown source_table'
           where id = v_job.id;
          continue;
      end case;

      update public.gl_posting_outbox
         set status = 'posted', journal_entry_id = v_entry, posted_at = now()
       where id = v_job.id;
      v_done := v_done + 1;
    exception when others then
      update public.gl_posting_outbox
         set status = 'failed', last_error = left(sqlerrm, 500), attempts = attempts + 1
       where id = v_job.id;
    end;
  end loop;

  return v_done;
end;
$function$;

-- ===========================================================================
-- 5. void_purchase_order — re-sourced VERBATIM from the LIVE proc
--    (pg_get_functiondef, 2026-07-04; carries #287's project_director gate) +
--    a charge reverse/skip loop before the PO delete. A voided PO's charges
--    cascade away on the FK, but their GL entries / outbox jobs do NOT — so
--    reverse a posted charge entry or skip a still-pending job (same
--    look-up-then-reverse the members already use), then let the cascade drop
--    the rows.
-- ===========================================================================
create or replace function public.void_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
          not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'void_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  select po_number, supplier into v_po_number, v_supplier
    from public.purchase_orders
   where id = p_po_id;
  if v_po_number is null then
    raise exception 'void_purchase_order: purchase order not found'
      using errcode = 'P0001';
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
    raise exception 'void_purchase_order: order has a shipped or received line'
      using errcode = 'P0001';
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
       'request_ids', to_jsonb(v_request_ids)
     ));

  -- purchase_order_deliveries + purchase_order_charges cascade on their FKs;
  -- the PO's po_number is retired, never reused (the running-sequence rule).
  delete from public.purchase_orders where id = p_po_id;
end;
$function$;
