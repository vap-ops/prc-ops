-- Spec 275 U3g — widen the settlement RPC gate to the full rental create-audience.
--
-- U3d gated record_/supersede_rental_settlement to pm/super/procurement (spec §U3
-- shorthand). But the codebase enforces two role-inclusion INVARIANTS (pgTAP 90 /
-- 261): every project_manager-gated RPC must also admit project_director, and
-- every procurement-gated RPC must also admit procurement_manager. The narrow gate
-- violated both. Correct it to the 5-role set used by add_rental_charge (U2) and
-- create_equipment_rental_batch — project_manager / super_admin / procurement /
-- procurement_manager / project_director. CREATE OR REPLACE (the U3d functions are
-- already applied); only the gate line changes, bodies otherwise identical to U3d.

create or replace function public.record_rental_settlement(
  p_agreement_id     uuid,
  p_invoice_no       text,
  p_invoice_date     date,
  p_base             numeric,
  p_overtime         numeric,
  p_fees             numeric,
  p_vat              numeric,
  p_deposit_refunded numeric,
  p_deposit_forfeited numeric,
  p_method           public.receipt_method,
  p_note             text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier    uuid;
  v_deposit_cap numeric(12, 2);
  v_is_vat      boolean;
  v_taxid       text;
  v_base        numeric(12, 2) := coalesce(p_base, 0);
  v_overtime    numeric(12, 2) := coalesce(p_overtime, 0);
  v_fees        numeric(12, 2) := coalesce(p_fees, 0);
  v_vat         numeric(12, 2);
  v_refunded    numeric(12, 2) := coalesce(p_deposit_refunded, 0);
  v_forfeited   numeric(12, 2) := coalesce(p_deposit_forfeited, 0);
  v_net         numeric(12, 2);
  v_wht_rate    numeric(5, 2);
  v_wht         numeric(12, 2) := 0;
  v_id          uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement',
             'procurement_manager', 'project_director') then
    raise exception 'record_rental_settlement: role not permitted' using errcode = '42501';
  end if;

  select supplier_id, deposit_amount, tax_id
    into v_supplier, v_deposit_cap, v_taxid
    from public.equipment_rental_batches b
    left join public.suppliers s on s.id = b.supplier_id
   where b.id = p_agreement_id;
  if not found then
    raise exception 'record_rental_settlement: agreement not found' using errcode = 'P0001';
  end if;

  select coalesce(is_vat_registered, false) into v_is_vat
    from public.suppliers where id = v_supplier;

  if p_invoice_date is null or p_method is null then
    raise exception 'record_rental_settlement: invoice date and method required' using errcode = 'P0001';
  end if;
  if v_refunded + v_forfeited > coalesce(v_deposit_cap, 0) then
    raise exception 'record_rental_settlement: deposit refunded+forfeited exceeds the agreement deposit'
      using errcode = 'P0001';
  end if;

  v_vat := case when v_is_vat then coalesce(p_vat, 0) else 0 end;
  v_net := v_base + v_overtime + v_fees;

  select default_rate into v_wht_rate from public.wht_rates where income_type = 'rent';
  if v_base > 0 and coalesce(v_taxid, '') ~ '^\d{13}$' then
    v_wht := round(v_base * coalesce(v_wht_rate, 0) / 100, 2);
  end if;

  insert into public.rental_settlements
    (agreement_id, invoice_no, invoice_date, base_amount, overtime_amount, fees_amount,
     net_amount, vat_amount, wht_amount, deposit_refunded, deposit_forfeited, method, note, created_by)
  values
    (p_agreement_id, btrim(coalesce(p_invoice_no, '')), p_invoice_date, v_base, v_overtime, v_fees,
     v_net, v_vat, v_wht, v_refunded, v_forfeited, p_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'rental_settlement_record', 'rental_settlements', v_id,
          jsonb_build_object('agreement_id', p_agreement_id, 'invoice_no', p_invoice_no,
                             'net_amount', v_net, 'wht_amount', v_wht));

  if v_wht > 0 then
    insert into public.wht_certificates
      (direction, tax_form, supplier_id, tax_id_13, income_type, base_amount, wht_rate, wht_amount,
       pay_source_table, pay_source_id, issued_date, created_by)
    values
      ('deducted', 'pnd53', v_supplier, v_taxid, 'rent', v_base, v_wht_rate, v_wht,
       'rental_settlements', v_id, p_invoice_date, auth.uid());

    insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
    values (auth.uid(), public.current_user_role(), 'wht_certificate_record', 'rental_settlements', v_id,
            jsonb_build_object('income_type', 'rent', 'base_amount', v_base, 'wht_amount', v_wht));
  end if;

  return v_id;
end;
$$;

create or replace function public.supersede_rental_settlement(
  p_settlement_id    uuid,
  p_invoice_no       text,
  p_invoice_date     date,
  p_base             numeric,
  p_overtime         numeric,
  p_fees             numeric,
  p_vat              numeric,
  p_deposit_refunded numeric,
  p_deposit_forfeited numeric,
  p_method           public.receipt_method,
  p_correction_reason text,
  p_note             text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target      public.rental_settlements%rowtype;
  v_deposit_cap numeric(12, 2);
  v_is_vat      boolean;
  v_base        numeric(12, 2) := coalesce(p_base, 0);
  v_overtime    numeric(12, 2) := coalesce(p_overtime, 0);
  v_fees        numeric(12, 2) := coalesce(p_fees, 0);
  v_vat         numeric(12, 2);
  v_refunded    numeric(12, 2) := coalesce(p_deposit_refunded, 0);
  v_forfeited   numeric(12, 2) := coalesce(p_deposit_forfeited, 0);
  v_net         numeric(12, 2);
  v_id          uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'procurement',
             'procurement_manager', 'project_director') then
    raise exception 'supersede_rental_settlement: role not permitted' using errcode = '42501';
  end if;

  select * into v_target from public.rental_settlements where id = p_settlement_id;
  if not found then
    raise exception 'supersede_rental_settlement: settlement not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.rental_settlements n where n.superseded_by = p_settlement_id) then
    raise exception 'supersede_rental_settlement: settlement already superseded' using errcode = 'P0001';
  end if;
  if p_invoice_date is null or p_method is null then
    raise exception 'supersede_rental_settlement: invoice date and method required' using errcode = 'P0001';
  end if;
  if p_correction_reason is null or btrim(p_correction_reason) = '' then
    raise exception 'supersede_rental_settlement: correction_reason required' using errcode = 'P0001';
  end if;

  select deposit_amount into v_deposit_cap
    from public.equipment_rental_batches where id = v_target.agreement_id;
  if v_refunded + v_forfeited > coalesce(v_deposit_cap, 0) then
    raise exception 'supersede_rental_settlement: deposit refunded+forfeited exceeds the agreement deposit'
      using errcode = 'P0001';
  end if;

  select coalesce(is_vat_registered, false) into v_is_vat
    from public.suppliers s
    join public.equipment_rental_batches b on b.supplier_id = s.id
   where b.id = v_target.agreement_id;
  v_vat := case when coalesce(v_is_vat, false) then coalesce(p_vat, 0) else 0 end;
  v_net := v_base + v_overtime + v_fees;

  insert into public.rental_settlements
    (agreement_id, invoice_no, invoice_date, base_amount, overtime_amount, fees_amount,
     net_amount, vat_amount, wht_amount, deposit_refunded, deposit_forfeited, method, note,
     created_by, superseded_by, correction_reason)
  values
    (v_target.agreement_id, btrim(coalesce(p_invoice_no, '')), p_invoice_date, v_base, v_overtime, v_fees,
     v_net, v_vat, v_target.wht_amount, v_refunded, v_forfeited, p_method,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_settlement_id, btrim(p_correction_reason))
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (auth.uid(), public.current_user_role(), 'rental_settlement_supersede', 'rental_settlements', v_id,
          jsonb_build_object('superseded', p_settlement_id, 'net_amount', v_net,
                             'correction_reason', btrim(p_correction_reason)));
  return v_id;
end;
$$;
