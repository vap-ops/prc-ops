-- Spec 324 U3 — GL contra for a receipt correction.
--
-- The original รับเข้า posted Dr 1500 (net) / Dr 1300 (vat) / Cr 2100 (gross).
-- A correction that removes `removed_qty` at the receipt's net unit cost must
-- post the exact CONTRA: Cr 1500 (removed_net) / Cr 1300 (removed_vat, if any) /
-- Dr 2100 (removed_gross). Amounts are VAT-RESIDUAL — Dr 2100 = Cr1500 + Cr1300,
-- never three independently-rounded legs (a satang imbalance would make
-- post_journal_internal raise → the drain marks the job `failed` forever while
-- on-hand already dropped). We do NOT reuse post_stock_reversal_to_gl (net-only,
-- strands Input VAT).
--
-- Posted into the CURRENT open period (current_date), NOT the receipt's date — a
-- post-month-close correction into the receipt's period would P0002 → strand a
-- `failed` outbox row while on-hand already moved.
--
-- Zero-net (free/sample unit_cost 0, or true_qty == current) → post NO entry
-- (return null): a 0/0 line fails the engine's one-sided check; the outbox job
-- still marks `posted` with no entry.
--
-- Enqueue trigger + drain CASE ship in THIS migration, name-matched to the
-- enqueue source_table string — a mismatch or a missing CASE silently marks the
-- job `skipped`, which posting_backlog_zero does NOT count (silent drift).
--
-- Reverse-and-repost self-guard keyed on (source_table, source_id, source_event)
-- makes an overlapping drain (no SKIP LOCKED) idempotent — the
-- receipt_poster_redrain_guard class.

-- ---------------------------------------------------------------------------
create function public.post_stock_receipt_correction_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project  uuid;
  v_net      numeric(16,2);
  v_vat      numeric(16,2);
  v_gross    numeric(16,2);
  v_supplier uuid;
  v_actor    uuid;
  v_receipt  uuid;
  v_old      uuid;
  v_lines    jsonb;
begin
  select removed_net, removed_vat, supplier_id, corrected_by, receipt_id
    into v_net, v_vat, v_supplier, v_actor, v_receipt
    from public.stock_receipt_corrections where id = p_source_id;
  if not found then
    raise exception 'post_stock_receipt_correction_to_gl: correction not found' using errcode = 'P0001';
  end if;
  select project_id into v_project from public.stock_receipts where id = v_receipt;

  -- Zero-value skip (a 0/0 journal line fails the one-sided check).
  if coalesce(v_net, 0) = 0 then
    return null;
  end if;

  -- Gross is the RESIDUAL of the two credited legs (never a third rounding).
  v_gross := v_net + coalesce(v_vat, 0);

  -- Reverse-and-repost: reverse the current (non-reversed) entry for THIS
  -- correction so an overlapping drain self-heals instead of double-posting.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_receipt_corrections'
     and e.source_id    = p_source_id
     and e.source_event = 'stock_receipt_correction'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: receipt correction re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1500', 'credit', v_net, 'project_id', v_project));
  if coalesce(v_vat, 0) > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1300', 'credit', v_vat,
                       'project_id', v_project);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'debit', v_gross,
                       'supplier_id', v_supplier);

  return public.post_journal_internal(
    current_date, 'stock_receipt_corrections', p_source_id, 'stock_receipt_correction',
    'แก้ไขจำนวนรับเข้าสโตร์', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_stock_receipt_correction_to_gl(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue trigger: source_event='stock_receipt_correction', id column='id'.
-- ---------------------------------------------------------------------------
create trigger stock_receipt_corrections_enqueue_gl_posting
  after insert on public.stock_receipt_corrections
  for each row execute function public.enqueue_gl_posting_tg('stock_receipt_correction', 'id');

-- ---------------------------------------------------------------------------
-- drain_gl_posting — LIVE body (2026-07-16) + a CASE arm for the corrections
-- source_table. NAME-MATCHED to the enqueue's tg_table_name
-- ('stock_receipt_corrections') so the job posts, never silently `skipped`.
-- ---------------------------------------------------------------------------
create or replace function public.drain_gl_posting(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
        when 'wage_payments'            then v_entry := public.post_wage_payment_to_gl(v_job.source_id);
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
        when 'stock_receipt_corrections' then v_entry := public.post_stock_receipt_correction_to_gl(v_job.source_id);
        when 'subcontract_payments'     then v_entry := public.post_subcontract_payment_to_gl(v_job.source_id);
        when 'purchase_order_charges'   then v_entry := public.post_purchase_order_charge_to_gl(v_job.source_id);
        when 'rental_charges'           then v_entry := public.post_rental_charge_to_gl(v_job.source_id);
        -- Spec 275 U3: the vendor invoice settlement (thin: overtime + deposit
        -- release only) and the deposit-paid leg (synthetic source_table).
        when 'rental_settlements'       then v_entry := public.post_rental_settlement_to_gl(v_job.source_id);
        when 'rental_deposits'          then v_entry := public.post_rental_deposit_to_gl(v_job.source_id);
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
$$;
