-- Spec 178 B6a / ADR 0057 — post store movements to the GL, at COST. The store
-- holds INVENTORY (an asset) between รับเข้า and เบิก, which the construction
-- skeleton COA lacked (purchases went straight to WIP). Operator (AskUserQuestion
-- 2026-06-23): the full standard perpetual-inventory scheme + a new Inventory
-- account. This unit (B6a) does the two core legs — receive + issue; count
-- (shrinkage) + reversal legs are B6b.
--
--   รับเข้า (stock_receipts):  Dr Inventory 1500 / Cr AP 2100          [cost]
--   เบิก   (stock_issues):     Dr WIP 1400 (project+WP) / Cr Inventory [moving-avg cost]
--
-- Mechanism mirrors post_purchase_to_gl: reverse-and-repost (auto-correct),
-- SECURITY DEFINER + service_role-only, balanced via post_journal_internal; an
-- AFTER-INSERT trigger enqueues the async job (the U4a/U4c outbox + drainer). The
-- SELL price / store margin stays in the management P&L (wp_profit + store_pnl) —
-- the GL is the statutory COST book. Issues are tagged source_table='stock_issues'
-- (NOT 'purchase_requests'), so wp_profit's 1400-purchase-filtered materials term
-- excludes them — no double-count with the store-issue-sell term it already adds.

-- 1. The Inventory asset account (idempotent; the accountant's real COA extends
--    the skeleton — ADR 0057). Under Assets (1000), after WIP (1400).
insert into public.gl_accounts
  (code, name_th, name_en, account_type, normal_side, is_postable, parent_id, sort_order)
values
  ('1500', 'วัสดุคงคลัง (สโตร์หน้างาน)', 'Inventory - site store', 'asset', 'debit', true,
   (select id from public.gl_accounts where code = '1000'), 70)
on conflict (code) do nothing;

-- 2. Receive poster: Dr Inventory 1500 / Cr AP 2100 at cost. supplier_id may be
--    null (an unsourced receipt) — the AP line then carries no party.
create function public.post_stock_receipt_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project  uuid;
  v_cost     numeric(16,2);
  v_supplier uuid;
  v_actor    uuid;
  v_at       date;
  v_old      uuid;
  v_lines    jsonb;
begin
  select project_id, total_cost, supplier_id, created_by, coalesce(received_at::date, current_date)
    into v_project, v_cost, v_supplier, v_actor, v_at
    from public.stock_receipts where id = p_source_id;
  if not found then
    raise exception 'post_stock_receipt_to_gl: receipt not found' using errcode = 'P0001';
  end if;

  -- Reverse-and-repost: reverse the current (non-reversed) entry for this receipt.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_receipts'
     and e.source_id    = p_source_id
     and e.source_event = 'stock_receive'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: stock receipt re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1500', 'debit', v_cost, 'project_id', v_project),
    jsonb_build_object('account_code', '2100', 'credit', v_cost, 'supplier_id', v_supplier));

  return public.post_journal_internal(
    v_at, 'stock_receipts', p_source_id, 'stock_receive', 'รับเข้าสโตร์', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_stock_receipt_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_receipt_to_gl(uuid) to service_role;

-- 3. Issue poster: Dr WIP 1400 (project + WP) / Cr Inventory 1500 at moving-avg
--    cost. total_cost is the COST snapshot (qty * unit_cost), NOT the sell.
create function public.post_stock_issue_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_wp      uuid;
  v_cost    numeric(16,2);
  v_actor   uuid;
  v_at      date;
  v_old     uuid;
  v_lines   jsonb;
begin
  select project_id, work_package_id, total_cost, issued_by, coalesce(issued_at::date, current_date)
    into v_project, v_wp, v_cost, v_actor, v_at
    from public.stock_issues where id = p_source_id;
  if not found then
    raise exception 'post_stock_issue_to_gl: issue not found' using errcode = 'P0001';
  end if;

  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_issues'
     and e.source_id    = p_source_id
     and e.source_event = 'stock_issue'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: stock issue re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1400', 'debit', v_cost,
                       'project_id', v_project, 'work_package_id', v_wp),
    jsonb_build_object('account_code', '1500', 'credit', v_cost, 'project_id', v_project));

  return public.post_journal_internal(
    v_at, 'stock_issues', p_source_id, 'stock_issue', 'เบิกออกจากสโตร์', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_stock_issue_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_issue_to_gl(uuid) to service_role;

-- 4. Enqueue triggers (append-only tables → AFTER INSERT only; the generic
--    SECURITY DEFINER enqueue trigger works for every writer, cannot fail the write).
create trigger stock_receipts_enqueue_gl_posting
  after insert on public.stock_receipts
  for each row
  execute function public.enqueue_gl_posting_tg('stock_receive', 'id');
create trigger stock_issues_enqueue_gl_posting
  after insert on public.stock_issues
  for each row
  execute function public.enqueue_gl_posting_tg('stock_issue', 'id');

-- 5. Route the two new source tables in the drainer (CREATE OR REPLACE — same
--    signature, body adds two cases; grants preserved).
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
        -- Spec 149 U5/U5b/U6 cases — preserved (body sourced from the LIVE proc,
        -- not the stale original migration; the recurring "source from LIVE" lesson).
        when 'client_billings'          then v_entry := public.post_client_billing_to_gl(v_job.source_id);
        when 'retention_receivables'    then v_entry := public.post_retention_release_to_gl(v_job.source_id);
        when 'wht_certificates'         then v_entry := public.post_wht_certificate_to_gl(v_job.source_id);
        -- Spec 178 B6a — the two new store cases.
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
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
