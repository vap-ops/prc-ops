-- Spec 149 U6 / ADR 0057 decision 9 — the WHT-deducted poster + drain dispatch.
-- A deducted cert reclassifies a party payable into the WHT-payable liability:
--   contractor → Dr DC-clearing (2110) / Cr WHT-payable (2210)
--   supplier   → Dr AP-trade    (2100) / Cr WHT-payable (2210)
-- This composes with the payment posters: a DC/AP payment posts the NET cash
-- (paid_amount), and this entry clears the withheld remainder into WHT-payable —
-- no double count. A suffered cert posts nothing (the WHT-prepaid already posts at
-- billing certify). Reverse-and-repost (re-drain safety).

create function public.post_wht_certificate_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_direction  public.wht_direction;
  v_supplier   uuid;
  v_contractor uuid;
  v_amount     numeric(14,2);
  v_when       date;
  v_actor      uuid;
  v_dr_account text;
  v_old        uuid;
  v_lines      jsonb;
begin
  select direction, supplier_id, contractor_id, wht_amount, issued_date, created_by
    into v_direction, v_supplier, v_contractor, v_amount, v_when, v_actor
    from public.wht_certificates where id = p_source_id;
  if not found then
    raise exception 'post_wht_certificate_to_gl: certificate not found' using errcode = 'P0001';
  end if;

  -- Suffered = document only (the WHT-prepaid posted at billing certify).
  if v_direction <> 'deducted' then
    return null;
  end if;
  if coalesce(v_amount, 0) = 0 then
    return null;
  end if;

  -- The payable the WHT reclassifies from, by party.
  if v_contractor is not null then
    v_dr_account := '2110';  -- DC-clearing
  elsif v_supplier is not null then
    v_dr_account := '2100';  -- AP-trade
  else
    raise exception 'post_wht_certificate_to_gl: deducted cert has no payable party' using errcode = 'P0001';
  end if;

  -- Reverse current (non-reversed) entry for this cert (re-drain safety).
  select e.id into v_old from public.journal_entries e
    where e.source_table = 'wht_certificates' and e.source_id = p_source_id
      and e.source_event = 'wht_certificate' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: WHT cert re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_dr_account, 'debit', v_amount,
                       'supplier_id', v_supplier, 'contractor_id', v_contractor),
    jsonb_build_object('account_code', '2210', 'credit', v_amount));

  return public.post_journal_internal(
    v_when, 'wht_certificates', p_source_id, 'wht_certificate', 'WHT withheld', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_wht_certificate_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_wht_certificate_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
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
