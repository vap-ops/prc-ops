-- Spec 149 U5 / ADR 0057 decision 8 — the client-billing poster + drain dispatch.
-- On certify: Dr AR (net) + Dr Retention-recv + Dr WHT-prepaid / Cr Revenue (gross)
-- + Cr Output VAT. Balances because net + retention + wht == gross + vat.
-- AR + retention carry the client party; all lines carry the project dimension.
-- Reverse-and-repost (auto-correct), like the other posters.

create function public.post_client_billing_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project   uuid;
  v_client    uuid;
  v_gross     numeric(14,2);
  v_retention numeric(14,2);
  v_vat       numeric(14,2);
  v_wht       numeric(14,2);
  v_net       numeric(14,2);
  v_when      date;
  v_actor     uuid;
  v_status    public.client_billing_status;
  v_old       uuid;
  v_lines     jsonb;
begin
  select project_id, gross_amount, retention_amount, vat_amount, wht_suffered,
         net_receivable, coalesce(certified_at::date, current_date), certified_by, status
    into v_project, v_gross, v_retention, v_vat, v_wht, v_net, v_when, v_actor, v_status
    from public.client_billings where id = p_source_id;
  if not found then
    raise exception 'post_client_billing_to_gl: billing not found' using errcode = 'P0001';
  end if;
  if v_status <> 'certified' then
    raise exception 'post_client_billing_to_gl: billing not certified' using errcode = 'P0001';
  end if;

  select client_id into v_client from public.projects where id = v_project;

  -- Reverse current (non-reversed) entry for this billing (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'client_billings' and e.source_id = p_source_id
      and e.source_event = 'client_billing' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: billing re-posted');
  end if;

  -- Dr AR (net) [client party] + Cr Revenue (gross) — always present.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', v_net,
                       'project_id', v_project, 'client_id', v_client),
    jsonb_build_object('account_code', '4100', 'credit', v_gross, 'project_id', v_project));

  if coalesce(v_retention, 0) > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1210', 'debit', v_retention,
                       'project_id', v_project, 'client_id', v_client);
  end if;
  if coalesce(v_wht, 0) > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1310', 'debit', v_wht,
                       'project_id', v_project);
  end if;
  if coalesce(v_vat, 0) > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2200', 'credit', v_vat,
                       'project_id', v_project);
  end if;

  return public.post_journal_internal(
    v_when, 'client_billings', p_source_id, 'client_billing', 'งวด billing', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_client_billing_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_client_billing_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Extend the drainer dispatch with the client-billing source. Body = 20260743000200
-- + one case branch.
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
