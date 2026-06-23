-- Spec 178 B6b / ADR 0057 — the store GL adjustment legs (count + reversal), at
-- COST. Completes B6a (receive + issue). Same mechanism: SECURITY DEFINER +
-- service_role-only posters, balanced via post_journal_internal, AFTER-INSERT
-- enqueue triggers feeding the spec-149 outbox, drainer routing.
--
--   count shrinkage (short):  Dr COGS-materials 5100 / Cr Inventory 1500
--   count overage:            Dr Inventory 1500 / Cr COGS-materials 5100
--   count zero-variance:      no journal entry (poster returns null)
--   reverse a รับเข้า:        Dr AP 2100 / Cr Inventory 1500   (flip the receipt)
--   reverse a เบิก:           Dr Inventory 1500 / Cr WIP 1400  (flip the issue)

-- 1. Count poster — variance valued at the count's moving-avg cost.
create function public.post_stock_count_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_var     numeric(18,2);
  v_amt     numeric(18,2);
  v_actor   uuid;
  v_at      date;
  v_old     uuid;
  v_lines   jsonb;
begin
  select project_id, variance_value, counted_by, coalesce(counted_at::date, current_date)
    into v_project, v_var, v_actor, v_at
    from public.stock_counts where id = p_source_id;
  if not found then
    raise exception 'post_stock_count_to_gl: count not found' using errcode = 'P0001';
  end if;

  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_counts' and e.source_id = p_source_id
     and e.source_event = 'stock_count' and e.status = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: stock count re-posted');
  end if;

  -- A spot-on count has no GL effect.
  if coalesce(v_var, 0) = 0 then
    return null;
  end if;
  v_amt := abs(v_var);

  if v_var < 0 then
    -- Shrinkage: inventory down, materials cost (loss) up.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '5100', 'debit', v_amt, 'project_id', v_project),
      jsonb_build_object('account_code', '1500', 'credit', v_amt, 'project_id', v_project));
  else
    -- Overage: inventory up, cost recovered.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1500', 'debit', v_amt, 'project_id', v_project),
      jsonb_build_object('account_code', '5100', 'credit', v_amt, 'project_id', v_project));
  end if;

  return public.post_journal_internal(
    v_at, 'stock_counts', p_source_id, 'stock_count', 'ปรับปรุงยอดนับสโตร์', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_stock_count_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_count_to_gl(uuid) to service_role;

-- 2. Reversal poster — flips the original movement's entry (reads the receipt/issue
--    it reverses for the cost + dims).
create function public.post_stock_reversal_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project  uuid;
  v_receipt  uuid;
  v_issue    uuid;
  v_actor    uuid;
  v_at       date;
  v_cost     numeric(16,2);
  v_wp       uuid;
  v_supplier uuid;
  v_old      uuid;
  v_lines    jsonb;
begin
  select project_id, receipt_id, issue_id, reversed_by, coalesce(reversed_at::date, current_date)
    into v_project, v_receipt, v_issue, v_actor, v_at
    from public.stock_reversals where id = p_source_id;
  if not found then
    raise exception 'post_stock_reversal_to_gl: reversal not found' using errcode = 'P0001';
  end if;

  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_reversals' and e.source_id = p_source_id
     and e.source_event = 'stock_reversal' and e.status = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: stock reversal re-posted');
  end if;

  if v_receipt is not null then
    -- Flip the รับเข้า (Dr Inventory / Cr AP) → Dr AP / Cr Inventory.
    select total_cost, supplier_id into v_cost, v_supplier
      from public.stock_receipts where id = v_receipt;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '2100', 'debit', v_cost, 'supplier_id', v_supplier),
      jsonb_build_object('account_code', '1500', 'credit', v_cost, 'project_id', v_project));
  else
    -- Flip the เบิก (Dr WIP / Cr Inventory) → Dr Inventory / Cr WIP.
    select total_cost, work_package_id into v_cost, v_wp
      from public.stock_issues where id = v_issue;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1500', 'debit', v_cost, 'project_id', v_project),
      jsonb_build_object('account_code', '1400', 'credit', v_cost,
                         'project_id', v_project, 'work_package_id', v_wp));
  end if;

  return public.post_journal_internal(
    v_at, 'stock_reversals', p_source_id, 'stock_reversal', 'กลับรายการสโตร์', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_stock_reversal_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_reversal_to_gl(uuid) to service_role;

-- 3. Enqueue triggers (append-only → AFTER INSERT only).
create trigger stock_counts_enqueue_gl_posting
  after insert on public.stock_counts
  for each row
  execute function public.enqueue_gl_posting_tg('stock_count', 'id');
create trigger stock_reversals_enqueue_gl_posting
  after insert on public.stock_reversals
  for each row
  execute function public.enqueue_gl_posting_tg('stock_reversal', 'id');

-- 4. Route the two new sources (CREATE OR REPLACE — body sourced from the LIVE
--    9-case proc, NOT a stale migration; + the two new cases. The B6a lesson.).
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
        when 'dc_payments'              then v_entry := public.post_dc_payment_to_gl(v_job.source_id);
        when 'wp_labor_costs'           then v_entry := public.post_labor_freeze_to_gl(v_job.source_id);
        when 'equipment_rental_batches' then v_entry := public.post_rental_batch_to_gl(v_job.source_id);
        when 'client_billings'          then v_entry := public.post_client_billing_to_gl(v_job.source_id);
        when 'retention_receivables'    then v_entry := public.post_retention_release_to_gl(v_job.source_id);
        when 'wht_certificates'         then v_entry := public.post_wht_certificate_to_gl(v_job.source_id);
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        when 'stock_counts'             then v_entry := public.post_stock_count_to_gl(v_job.source_id);
        when 'stock_reversals'          then v_entry := public.post_stock_reversal_to_gl(v_job.source_id);
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
revoke all on function public.drain_gl_posting(integer) from public, anon, authenticated;
grant execute on function public.drain_gl_posting(integer) to service_role;
