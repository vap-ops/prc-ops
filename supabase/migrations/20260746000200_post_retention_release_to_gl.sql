-- Spec 149 U5b / ADR 0057 decision 8 — the retention-release poster + drain
-- dispatch. On release: Dr Bank (1110) / Cr Retention receivable (1210), the
-- withheld amount, client party + project dim. Links the resulting entry back
-- onto retention_receivables.release_entry_id. Reverse-and-repost (re-drain safety).

create function public.post_retention_release_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_client  uuid;
  v_amount  numeric(14,2);
  v_when    date;
  v_actor   uuid;
  v_status  public.retention_status;
  v_old     uuid;
  v_entry   uuid;
  v_lines   jsonb;
begin
  select project_id, amount_withheld, coalesce(released_at::date, current_date), released_by, status
    into v_project, v_amount, v_when, v_actor, v_status
    from public.retention_receivables where id = p_source_id;
  if not found then
    raise exception 'post_retention_release_to_gl: retention not found' using errcode = 'P0001';
  end if;
  if v_status <> 'released' then
    raise exception 'post_retention_release_to_gl: retention not released' using errcode = 'P0001';
  end if;

  select client_id into v_client from public.projects where id = v_project;

  -- Reverse current (non-reversed) release entry for this retention (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'retention_receivables' and e.source_id = p_source_id
      and e.source_event = 'retention_release' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: retention release re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1110', 'debit',  v_amount, 'project_id', v_project),
    jsonb_build_object('account_code', '1210', 'credit', v_amount,
                       'project_id', v_project, 'client_id', v_client));

  v_entry := public.post_journal_internal(
    v_when, 'retention_receivables', p_source_id, 'retention_release',
    'Retention released', v_lines, null, v_actor);

  -- Link the entry back (does not change status → no re-enqueue).
  update public.retention_receivables set release_entry_id = v_entry where id = p_source_id;
  return v_entry;
end;
$$;
revoke all on function public.post_retention_release_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_retention_release_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Extend the drainer dispatch with the retention-release source.
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
