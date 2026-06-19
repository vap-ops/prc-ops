-- Spec 149 U4c / ADR 0057 decision 12 — drain_gl_posting: the service-role loop
-- that consumes the gl_posting_outbox and posts each pending job via the right
-- per-source poster. Called on a schedule by the worker/cron (service_role).
-- Per-row exception isolation: a poster failure marks that one job 'failed'
-- (last_error + attempts++) and the loop continues — one bad row never blocks the
-- queue. A poster may return NULL (a void DC payment, a zero-cost freeze): the job
-- is still 'posted' (processed) with a NULL journal_entry_id.

create function public.drain_gl_posting(p_limit integer default 50)
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
