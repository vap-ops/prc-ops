-- Fix (2026-06-28) / ADR 0057 — restore the store-ADJUSTMENT routing the drainer
-- silently lost. Discovered reconciling a ฿16,400 inventory drift: a ตรวจนับ
-- (stock_counts.id 9bfe2105-…, variance −16,400) reduced stock_on_hand but never
-- posted Dr 5100 / Cr 1500. Its enqueue trigger DID fire — but drain_gl_posting hit
-- the `else` arm and marked the job 'skipped' (unknown source_table).
--
-- ROOT CAUSE — the recurring "CREATE OR REPLACE re-sourced a stale body" trap
-- ([[gl-posting-drain-unscheduled]], spec 189 same trap). Spec 178 B6b
-- (20260809002000) added the stock_counts + stock_reversals cases. Spec 209 U1
-- (20260813003800) then CREATE OR REPLACE'd drain to add stock_returns, but sourced
-- its body from 20260809001900 (B6a — the PRE-count/reversal version) instead of
-- from LIVE. Its own comment admits it: "body == the LIVE 20260809001900 §5 plus
-- the one new case." 20260809001900 is B6a, NOT B6b → the two B6b cases were dropped.
--
-- LIVE evidence (read 2026-06-28): drain routes receipts/issues/returns but NOT
-- counts/reversals; gl_posting_outbox holds 5 stock_counts:skipped jobs; GL 1500 is
-- fed only by stock_receipts + journal_reversal. The 5 enqueue triggers and all 5
-- posters (post_stock_count_to_gl, post_stock_reversal_to_gl, …) ALL exist + are
-- enabled on live — only the drainer's CASE lost the two arms.
--
-- THIS MIGRATION: CREATE OR REPLACE drain_gl_posting with ALL store cases. Body
-- sourced VERBATIM from LIVE (== 20260813003800 §5) so stock_returns is NOT
-- re-dropped, plus the two restored cases. Idempotent, additive, inert on existing
-- data (drain only selects status='pending'; the 5 historical 'skipped' rows stay
-- skipped — operator re-queues them separately). No trigger/poster changes.
--
-- DO NOT re-source this body from a migration file again — source from LIVE
-- (pg_get_functiondef('public.drain_gl_posting(integer)'::regprocedure)). pgTAP 235
-- now pins that every stock_* source_table routes, so a future re-source trap fails CI.

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
        -- Store movements (spec 178 B6a/B6b + 209 U1). receive/issue/return survived
        -- the spec-209 re-source; count/reversal were the dropped arms restored here.
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        when 'stock_returns'            then v_entry := public.post_stock_return_to_gl(v_job.source_id);
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
