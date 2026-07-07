-- Spec 275 U2d — register the rental_charges poster in the GL drain route.
--
-- CREATE OR REPLACE (signature unchanged) preserves the grants + the pg_cron
-- schedule. The body is re-sourced from the LATEST live definition (spec 266
-- 20260813071700_spec266u1_worker_identity_merge.sql), which carries the DC→worker
-- 'wage_payments' arm — NOT the older 'dc_payments' (copying an earlier migration
-- would silently regress that rename). Per the GL-drain re-source lesson (memory
-- gl-posting-drain-unscheduled): every existing arm is reproduced verbatim and
-- exactly ONE new 'rental_charges' arm is added, before the else. RECONCILE this
-- body against LIVE (pg_get_functiondef('public.drain_gl_posting(integer)')) at
-- db:push time in case of drift; the pgTAP `like all(...)` pin (275 test) fails
-- the build if any arm is dropped.
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
        when 'subcontract_payments'     then v_entry := public.post_subcontract_payment_to_gl(v_job.source_id);
        when 'purchase_order_charges'   then v_entry := public.post_purchase_order_charge_to_gl(v_job.source_id);
        -- Spec 275 U2: one-time rental fees — Dr 1400 WIP (net) + Dr 1300 Input
        -- VAT / Cr 2100 AP (supplier); no member split.
        when 'rental_charges'           then v_entry := public.post_rental_charge_to_gl(v_job.source_id);
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
