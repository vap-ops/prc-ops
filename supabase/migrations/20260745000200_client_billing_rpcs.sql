-- Spec 149 U5 / ADR 0057 decision 8 — client-billing write path:
--   create_client_billing  — draft a claim (pm/super).
--   certify_client_billing — compute + snapshot the derived amounts, accrue the
--                            retention 'held', flip to 'certified' (which the
--                            enqueue trigger turns into a GL post job).
-- Both SECURITY DEFINER on the authenticated session.

create function public.create_client_billing(
  p_project_id     uuid,
  p_gross_amount   numeric,
  p_retention_rate numeric default 5,
  p_vat_rate       numeric default 7,
  p_wht_rate       numeric default 3,
  p_period_from    date default null,
  p_period_to      date default null,
  p_note           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_client_billing: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'create_client_billing: project not found' using errcode = 'P0001';
  end if;
  if p_gross_amount is null or p_gross_amount <= 0 then
    raise exception 'create_client_billing: gross must be > 0' using errcode = 'P0001';
  end if;
  if coalesce(p_retention_rate,0) < 0 or coalesce(p_retention_rate,0) > 100
     or coalesce(p_vat_rate,0) < 0 or coalesce(p_vat_rate,0) > 100
     or coalesce(p_wht_rate,0) < 0 or coalesce(p_wht_rate,0) > 100 then
    raise exception 'create_client_billing: rate out of range' using errcode = 'P0001';
  end if;

  insert into public.client_billings
    (project_id, gross_amount, retention_rate, vat_rate, wht_rate, period_from, period_to, note, created_by)
  values
    (p_project_id, p_gross_amount, coalesce(p_retention_rate,5), coalesce(p_vat_rate,7),
     coalesce(p_wht_rate,3), p_period_from, p_period_to,
     nullif(btrim(coalesce(p_note,'')),''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_billing_create', auth.uid(), public.current_user_role(),
          'client_billings', v_id,
          jsonb_build_object('project_id', p_project_id, 'gross_amount', p_gross_amount));
  return v_id;
end;
$$;
revoke all on function public.create_client_billing(uuid, numeric, numeric, numeric, numeric, date, date, text)
  from public, anon;
grant execute on function public.create_client_billing(uuid, numeric, numeric, numeric, numeric, date, date, text)
  to authenticated;

-- ----------------------------------------------------------------------------
create function public.certify_client_billing(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project   uuid;
  v_gross     numeric(14,2);
  v_ret_rate  numeric(5,2);
  v_vat_rate  numeric(5,2);
  v_wht_rate  numeric(5,2);
  v_status    public.client_billing_status;
  v_retention numeric(14,2);
  v_vat       numeric(14,2);
  v_wht       numeric(14,2);
  v_net       numeric(14,2);
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'certify_client_billing: role not permitted' using errcode = '42501';
  end if;

  select project_id, gross_amount, retention_rate, vat_rate, wht_rate, status
    into v_project, v_gross, v_ret_rate, v_vat_rate, v_wht_rate, v_status
    from public.client_billings where id = p_id;
  if not found then
    raise exception 'certify_client_billing: billing not found' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'submitted') then
    raise exception 'certify_client_billing: only a draft/submitted claim can be certified' using errcode = 'P0001';
  end if;

  -- Mirror src/lib/accounting/client-billing.ts computeBillingBreakdown.
  v_retention := round(v_gross * v_ret_rate / 100, 2);
  v_vat       := round(v_gross * v_vat_rate / 100, 2);
  v_wht       := round(v_gross * v_wht_rate / 100, 2);
  v_net       := round(v_gross + v_vat - v_retention - v_wht, 2);

  update public.client_billings
     set retention_amount = v_retention,
         vat_amount       = v_vat,
         wht_suffered     = v_wht,
         net_receivable   = v_net,
         status           = 'certified',
         certified_at     = now(),
         certified_by     = auth.uid()
   where id = p_id;

  -- Accrue the withheld retention (held) — one per billing.
  if v_retention > 0 then
    insert into public.retention_receivables (project_id, client_billing_id, amount_withheld)
    values (v_project, p_id, v_retention)
    on conflict (client_billing_id) do nothing;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_billing_certify', auth.uid(), public.current_user_role(),
          'client_billings', p_id,
          jsonb_build_object('gross_amount', v_gross, 'retention_amount', v_retention,
                             'vat_amount', v_vat, 'wht_suffered', v_wht, 'net_receivable', v_net));
  return p_id;
end;
$$;
revoke all on function public.certify_client_billing(uuid) from public, anon;
grant execute on function public.certify_client_billing(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Enqueue the GL post when a billing becomes certified. Split INSERT/UPDATE — a
-- WHEN clause on an INSERT-or-UPDATE trigger may not reference OLD (42P17).
create trigger client_billings_enqueue_gl_posting_ins
  after insert on public.client_billings
  for each row
  when (new.status = 'certified')
  execute function public.enqueue_gl_posting_tg('client_billing', 'id');
create trigger client_billings_enqueue_gl_posting_upd
  after update on public.client_billings
  for each row
  when (new.status = 'certified' and old.status is distinct from new.status)
  execute function public.enqueue_gl_posting_tg('client_billing', 'id');
