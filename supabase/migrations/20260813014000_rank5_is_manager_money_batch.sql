-- Architecture-quality audit rank 5 (sql-role-helpers), stage 2 — batch 3 (money / GL / bank).
--
-- Adopt the SSOT predicate public.is_manager() (migration 20260813003200) in the
-- inline manager gate of these exact-PM-3 RPCs. Each gate
--   [public.]current_user_role() not in ('project_manager','super_admin','project_director')
-- becomes
--   not public.is_manager(public.current_user_role())
-- the SQL counterpart of isManagerRole (src/lib/auth/role-home.ts).
--
-- BEHAVIOUR-PRESERVING: is_manager(role) is defined as exactly that three-role
-- set and pgTAP 231 asserts TS<->SQL parity, so access is unchanged. Each body is
-- sourced VERBATIM from LIVE via pg_get_functiondef; the ONLY edit is the gate
-- predicate (one regex match asserted per function by the generator). CREATE OR
-- REPLACE preserves the existing EXECUTE grants (anon already revoked; pgTAP 229
-- re-confirms).
--
-- Functions (11): acknowledge_site_purchase, certify_client_billing, create_client_billing, decide_contractor_bank_change, decide_worker_bank_change, mark_retention_due, post_journal_entry, record_wht_certificate, release_retention, reverse_journal_entry, upsert_gl_account.

-- acknowledge_site_purchase
CREATE OR REPLACE FUNCTION public.acknowledge_site_purchase(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'acknowledge_site_purchase: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set acknowledged_at = now(),
         acknowledged_by = auth.uid()
   where id = p_id
     and source = 'site_purchase'
     and acknowledged_at is null;
  if not found then
    raise exception 'acknowledge_site_purchase: not an unacknowledged site purchase'
      using errcode = 'P0001';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'update',
     'purchase_requests',
     p_id,
     jsonb_build_object('source', 'site_purchase', 'transition', 'acknowledged'));
end;
$function$;

-- certify_client_billing
CREATE OR REPLACE FUNCTION public.certify_client_billing(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.is_manager(public.current_user_role()) then
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
$function$;

-- create_client_billing
CREATE OR REPLACE FUNCTION public.create_client_billing(p_project_id uuid, p_gross_amount numeric, p_retention_rate numeric DEFAULT 5, p_vat_rate numeric DEFAULT 7, p_wht_rate numeric DEFAULT 3, p_period_from date DEFAULT NULL::date, p_period_to date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
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
$function$;

-- decide_contractor_bank_change
CREATE OR REPLACE FUNCTION public.decide_contractor_bank_change(p_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.contractor_bank_change_requests%rowtype;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'decide_contractor_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.contractor_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_contractor_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_contractor_bank_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.contact_bank
       set bank_name = v_req.bank_name, bank_account_no = v_req.bank_account_no,
           bank_account_name = v_req.bank_account_name, updated_by = auth.uid(), updated_at = now()
     where contractor_id = v_req.contractor_id;
    if not found then
      insert into public.contact_bank
        (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (v_req.contractor_id, v_req.bank_name, v_req.bank_account_no,
              v_req.bank_account_name, auth.uid());
    end if;
  end if;

  update public.contractor_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$function$;

-- decide_worker_bank_change
CREATE OR REPLACE FUNCTION public.decide_worker_bank_change(p_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.worker_bank_change_requests%rowtype;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'decide_worker_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.worker_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_worker_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_worker_bank_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    -- Apply to the worker's own bank columns (inline — workers carry no
    -- contact_bank row; ADR 0062 U1 put bank_* on the worker).
    update public.workers
       set bank_name           = v_req.bank_name,
           bank_account_number = v_req.bank_account_number,
           bank_account_name   = v_req.bank_account_name
     where id = v_req.worker_id;
  end if;

  update public.worker_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$function$;

-- mark_retention_due
CREATE OR REPLACE FUNCTION public.mark_retention_due(p_id uuid, p_due_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.retention_status;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'mark_retention_due: role not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.retention_receivables where id = p_id;
  if not found then
    raise exception 'mark_retention_due: retention not found' using errcode = 'P0001';
  end if;
  if v_status <> 'held' then
    raise exception 'mark_retention_due: only a held retention can be marked due' using errcode = 'P0001';
  end if;

  update public.retention_receivables
     set status = 'due', due_date = p_due_date where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('retention_due', auth.uid(), public.current_user_role(),
          'retention_receivables', p_id, jsonb_build_object('due_date', p_due_date));
  return p_id;
end;
$function$;

-- post_journal_entry
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'post_journal_entry: role not permitted' using errcode = '42501';
  end if;
  return public.post_journal_internal(
    p_entry_date, 'manual', null, 'manual', p_memo, p_lines, null);
end;
$function$;

-- record_wht_certificate
CREATE OR REPLACE FUNCTION public.record_wht_certificate(p_direction wht_direction, p_tax_form wht_form, p_income_type text, p_tax_id text, p_base_amount numeric, p_wht_rate numeric DEFAULT NULL::numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_contractor_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid, p_pay_source_table text DEFAULT NULL::text, p_pay_source_id uuid DEFAULT NULL::uuid, p_issued_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rate   numeric(5,2);
  v_amount numeric(14,2);
  v_taxid  text := btrim(coalesce(p_tax_id, ''));
  v_id     uuid;
begin
  if not public.is_manager(public.current_user_role()) then
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
$function$;

-- release_retention
CREATE OR REPLACE FUNCTION public.release_retention(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.retention_status;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'release_retention: role not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.retention_receivables where id = p_id;
  if not found then
    raise exception 'release_retention: retention not found' using errcode = 'P0001';
  end if;
  if v_status not in ('held', 'due') then
    raise exception 'release_retention: retention is not releasable (status %)', v_status using errcode = 'P0001';
  end if;

  update public.retention_receivables
     set status = 'released', released_at = now(), released_by = auth.uid()
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('retention_release', auth.uid(), public.current_user_role(),
          'retention_receivables', p_id, jsonb_build_object('from_status', v_status));
  -- The GL post is enqueued by the status→released trigger below.
  return p_id;
end;
$function$;

-- reverse_journal_entry
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_memo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'reverse_journal_entry: role not permitted' using errcode = '42501';
  end if;
  return public.reverse_journal_internal(p_entry_id, auth.uid(), p_memo);
end;
$function$;

-- upsert_gl_account
CREATE OR REPLACE FUNCTION public.upsert_gl_account(p_code text, p_name_th text, p_name_en text, p_account_type gl_account_type, p_normal_side text, p_parent_code text DEFAULT NULL::text, p_is_postable boolean DEFAULT true, p_peak_account_code text DEFAULT NULL::text, p_sort_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code      text := btrim(coalesce(p_code, ''));
  v_name_th   text := btrim(coalesce(p_name_th, ''));
  v_name_en   text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_peak      text := nullif(btrim(coalesce(p_peak_account_code, '')), '');
  v_parent_raw text := nullif(btrim(coalesce(p_parent_code, '')), '');
  v_parent_id uuid;
  v_id        uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'upsert_gl_account: role not permitted' using errcode = '42501';
  end if;

  if v_code = '' or length(v_code) > 20 then
    raise exception 'upsert_gl_account: invalid code' using errcode = 'P0001';
  end if;
  if v_name_th = '' or length(v_name_th) > 120 then
    raise exception 'upsert_gl_account: invalid name' using errcode = 'P0001';
  end if;
  if p_normal_side not in ('debit', 'credit') then
    raise exception 'upsert_gl_account: normal_side must be debit or credit' using errcode = 'P0001';
  end if;

  -- Resolve the parent by code (the COA tree). Unknown parent = a friendly
  -- P0001 before the insert (the self-parent CHECK is the deeper guard).
  if v_parent_raw is not null then
    select id into v_parent_id from public.gl_accounts where code = v_parent_raw;
    if v_parent_id is null then
      raise exception 'upsert_gl_account: unknown parent code %', v_parent_raw using errcode = 'P0001';
    end if;
  end if;

  insert into public.gl_accounts
    (code, name_th, name_en, account_type, normal_side, parent_id, is_postable, peak_account_code, sort_order)
  values
    (v_code, v_name_th, v_name_en, p_account_type, p_normal_side, v_parent_id,
     coalesce(p_is_postable, true), v_peak, coalesce(p_sort_order, 0))
  on conflict (code) do update
    set name_th           = excluded.name_th,
        name_en           = excluded.name_en,
        account_type      = excluded.account_type,
        normal_side       = excluded.normal_side,
        parent_id         = excluded.parent_id,
        is_postable       = excluded.is_postable,
        peak_account_code = excluded.peak_account_code,
        sort_order        = excluded.sort_order,
        updated_at        = now()
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('gl_account_upsert', auth.uid(), public.current_user_role(),
          'gl_accounts', v_id,
          jsonb_build_object(
            'code', v_code,
            'account_type', p_account_type,
            'normal_side', p_normal_side,
            'parent_code', v_parent_raw,
            'is_postable', coalesce(p_is_postable, true),
            'peak_account_code', v_peak));

  return v_id;
end;
$function$;
