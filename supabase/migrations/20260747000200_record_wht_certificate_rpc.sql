-- Spec 149 U6 / ADR 0057 decision 9 — record_wht_certificate: create a WHT
-- certificate (the PND document). Computes wht_amount (or defaults the rate from
-- wht_rates by income_type). A deducted cert requires a payable party (supplier
-- or contractor) — that is the side the WHT reclassifies from. Enqueues the GL
-- post for deducted certs (suffered = document only). pm/super gate.

create function public.record_wht_certificate(
  p_direction     public.wht_direction,
  p_tax_form      public.wht_form,
  p_income_type   text,
  p_tax_id        text,
  p_base_amount   numeric,
  p_wht_rate      numeric default null,
  p_supplier_id   uuid default null,
  p_contractor_id uuid default null,
  p_client_id     uuid default null,
  p_pay_source_table text default null,
  p_pay_source_id    uuid default null,
  p_issued_date   date default null,
  p_note          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate   numeric(5,2);
  v_amount numeric(14,2);
  v_taxid  text := btrim(coalesce(p_tax_id, ''));
  v_id     uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'record_wht_certificate: role not permitted' using errcode = '42501';
  end if;

  if v_taxid !~ '^\d{13}$' then
    raise exception 'record_wht_certificate: tax id must be 13 digits' using errcode = 'P0001';
  end if;
  if p_base_amount is null or p_base_amount <= 0 then
    raise exception 'record_wht_certificate: base must be > 0' using errcode = 'P0001';
  end if;

  -- Rate: explicit, else the standard rate for the income type.
  select coalesce(p_wht_rate, default_rate) into v_rate
    from public.wht_rates where income_type = p_income_type;
  if v_rate is null then
    raise exception 'record_wht_certificate: unknown income_type %', p_income_type using errcode = 'P0001';
  end if;
  if v_rate < 0 or v_rate > 100 then
    raise exception 'record_wht_certificate: rate out of range' using errcode = 'P0001';
  end if;

  -- A deducted cert reclassifies a party payable → it needs exactly that party.
  if p_direction = 'deducted' and p_supplier_id is null and p_contractor_id is null then
    raise exception 'record_wht_certificate: a deducted certificate needs a supplier or contractor'
      using errcode = 'P0001';
  end if;

  v_amount := round(p_base_amount * v_rate / 100, 2);

  insert into public.wht_certificates
    (direction, tax_form, supplier_id, contractor_id, client_id, tax_id_13, income_type,
     base_amount, wht_rate, wht_amount, pay_source_table, pay_source_id, issued_date, note, created_by)
  values
    (p_direction, p_tax_form, p_supplier_id, p_contractor_id, p_client_id, v_taxid, p_income_type,
     p_base_amount, v_rate, v_amount, nullif(btrim(coalesce(p_pay_source_table,'')),''), p_pay_source_id,
     coalesce(p_issued_date, current_date), nullif(btrim(coalesce(p_note,'')),''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('wht_certificate_record', auth.uid(), public.current_user_role(),
          'wht_certificates', v_id,
          jsonb_build_object('direction', p_direction, 'tax_form', p_tax_form,
                             'income_type', p_income_type, 'base_amount', p_base_amount,
                             'wht_rate', v_rate, 'wht_amount', v_amount));
  return v_id;
end;
$$;
revoke all on function public.record_wht_certificate(
  public.wht_direction, public.wht_form, text, text, numeric, numeric, uuid, uuid, uuid, text, uuid, date, text)
  from public, anon;
grant execute on function public.record_wht_certificate(
  public.wht_direction, public.wht_form, text, text, numeric, numeric, uuid, uuid, uuid, text, uuid, date, text)
  to authenticated;

-- Enqueue the GL post for a deducted cert (suffered = document only). INSERT-only
-- (certs are immutable once recorded), so no OLD reference needed.
create trigger wht_certificates_enqueue_gl_posting_ins
  after insert on public.wht_certificates
  for each row
  when (new.direction = 'deducted')
  execute function public.enqueue_gl_posting_tg('wht_certificate', 'id');
