-- Spec 152 U2 / ADR 0058 — project_director RPC action gates.
--
-- project_director = a see-all project_manager (U1 shipped the enum + visibility).
-- This unit adds project_director to every SECURITY DEFINER RPC whose
-- current_user_role() gate already admits project_manager, so a director can
-- perform every PM action (create project/WP, record purchase, post journal,
-- etc.) across all projects. Operator-only RPCs (super_admin-alone) and the
-- accounting plumbing/posters (service-role / de-gated) are untouched.
--
-- Bodies are the LIVE definitions (pg_get_functiondef) with project_director
-- appended to each role list — behaviour-identical except the widened gate. The
-- only difference vs each source migration is the added role, so re-running a
-- later create-or-replace from an older spec would NOT regress this (those are
-- the same bodies). `55` functions, 55 gates.
--
-- NOTE: can_see_project is deliberately excluded (its membership branch lists
-- project_manager but director already passes via the see-all branch, U1).

CREATE OR REPLACE FUNCTION public.acknowledge_site_purchase(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.add_contact_document(p_contractor_id uuid DEFAULT NULL::uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_service_provider_id uuid DEFAULT NULL::uuid, p_purpose contact_doc_purpose DEFAULT NULL::contact_doc_purpose, p_storage_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_targets int := (p_contractor_id is not null)::int
                 + (p_supplier_id is not null)::int
                 + (p_service_provider_id is not null)::int;
  v_path text := nullif(btrim(p_storage_path), '');
  v_self uuid := public.current_user_contractor_id();
  v_is_staff boolean := public.current_user_role() in ('project_manager', 'super_admin', 'project_director');
  v_is_self_doc boolean := coalesce(
    v_self is not null
    and p_contractor_id = v_self
    and p_supplier_id is null
    and p_service_provider_id is null,
    false);
  v_id uuid;
begin
  if not (v_is_staff or v_is_self_doc) then
    raise exception 'add_contact_document: not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'add_contact_document: exactly one target required' using errcode = 'P0001';
  end if;
  if p_purpose is null then
    raise exception 'add_contact_document: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_contact_document: storage_path required' using errcode = 'P0001';
  end if;

  insert into public.contact_attachments
    (contractor_id, supplier_id, service_provider_id, purpose, storage_path, uploaded_by)
  values
    (p_contractor_id, p_supplier_id, p_service_provider_id, p_purpose, v_path, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_work_package_dependency(p_predecessor uuid, p_successor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'add_work_package_dependency: role not permitted' using errcode = '42501';
  end if;

  if p_predecessor = p_successor then
    return false;
  end if;

  -- both WPs must exist and share a project.
  if not exists (
    select 1 from public.work_packages a
      join public.work_packages b on a.project_id = b.project_id
     where a.id = p_predecessor and b.id = p_successor
  ) then
    return false;
  end if;

  -- cycle guard: reject if the successor can already reach the predecessor
  -- (adding predecessor -> successor would close a loop).
  if exists (
    with recursive reach as (
      select successor_id as node
        from public.work_package_dependencies
       where predecessor_id = p_successor
      union
      select d.successor_id
        from public.work_package_dependencies d
        join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = p_predecessor
  ) then
    return false;
  end if;

  insert into public.work_package_dependencies (predecessor_id, successor_id, created_by)
  values (p_predecessor, p_successor, auth.uid())
  on conflict (predecessor_id, successor_id) do nothing;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_wp_template(p_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type  public.project_type;
  v_count integer;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'apply_wp_template: role not permitted' using errcode = '42501';
  end if;
  select p.project_type into v_type from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'apply_wp_template: unknown project' using errcode = '22023';
  end if;
  if v_type is null then
    return 0;
  end if;

  insert into public.work_packages (project_id, code, name, description)
    select p_project_id, t.code, t.name, t.description
      from public.wp_templates t
     where t.project_type = v_type
     order by t.sort_order
  on conflict (project_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

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
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.clone_work_packages(p_src_project_id uuid, p_dst_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'clone_work_packages: role not permitted' using errcode = '42501';
  end if;
  if p_src_project_id = p_dst_project_id then
    raise exception 'clone_work_packages: source and destination must differ'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_src_project_id)
     or not exists (select 1 from public.projects p where p.id = p_dst_project_id) then
    raise exception 'clone_work_packages: unknown project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description)
    select p_dst_project_id, w.code, w.name, w.description
      from public.work_packages w
     where w.project_id = p_src_project_id
  on conflict (project_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.correct_labor_log(p_log uuid, p_reason text, p_fraction day_fraction DEFAULT NULL::day_fraction, p_tombstone boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig public.labor_logs%rowtype;
  v_worker_user uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'correct_labor_log: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'correct_labor_log: reason required (max 300 chars)'
      using errcode = 'P0001';
  end if;
  if not p_tombstone and p_fraction is null then
    raise exception 'correct_labor_log: new fraction required unless removing'
      using errcode = 'P0001';
  end if;

  select * into v_orig from public.labor_logs where id = p_log;
  if not found then
    raise exception 'correct_labor_log: log not found' using errcode = 'P0001';
  end if;
  if v_orig.day_fraction is null then
    raise exception 'correct_labor_log: cannot correct a removal'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_orig.work_package_id::text || '|'
                     || v_orig.worker_id::text || '|'
                     || v_orig.work_date::text, 0));

  if exists (select 1 from public.labor_logs newer
              where newer.superseded_by = p_log) then
    raise exception 'correct_labor_log: log already superseded'
      using errcode = 'P0001';
  end if;

  select w.user_id into v_worker_user
    from public.workers w where w.id = v_orig.worker_id;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged,
     superseded_by, correction_reason, note)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.worker_type_snapshot, v_orig.contractor_id_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason,
     -- Note carries forward unless edited; a tombstone removal clears it.
     case
       when p_tombstone then null
       when p_note is null then v_orig.note
       else nullif(btrim(p_note), '')
     end)
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_client_billing(p_project_id uuid, p_gross_amount numeric, p_retention_rate numeric DEFAULT 5, p_vat_rate numeric DEFAULT 7, p_wht_rate numeric DEFAULT 3, p_period_from date DEFAULT NULL::date, p_period_to date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.create_contractor_invite(p_contractor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_contractor_invite: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then
    raise exception 'create_contractor_invite: contractor not found' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.contractor_invites (contractor_id, token, created_by, expires_at)
  values (p_contractor_id, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_equipment_project_allocation(p_batch_id uuid, p_project_id uuid, p_starts_on date, p_ends_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_equipment_project_allocation: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe FK targets explicitly.
  perform 1 from public.equipment_rental_batches where id = p_batch_id;
  if not found then
    raise exception 'create_equipment_project_allocation: batch not found' using errcode = 'P0001';
  end if;
  perform 1 from public.projects where id = p_project_id;
  if not found then
    raise exception 'create_equipment_project_allocation: project not found' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_project_allocation: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_project_allocation: end before start' using errcode = 'P0001';
  end if;

  insert into public.equipment_project_allocations
    (batch_id, project_id, starts_on, ends_on, note, created_by)
  values (p_batch_id, p_project_id, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_allocation_create', auth.uid(), public.current_user_role(),
          'equipment_project_allocations', v_id,
          jsonb_build_object('batch_id', p_batch_id, 'project_id', p_project_id,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_equipment_rental_batch(p_owner_id uuid, p_monthly_rate numeric, p_starts_on date, p_ends_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_equipment_rental_batch: role not permitted' using errcode = '42501';
  end if;

  perform 1 from public.equipment_owners where id = p_owner_id;
  if not found then
    raise exception 'create_equipment_rental_batch: owner not found' using errcode = 'P0001';
  end if;
  if p_monthly_rate is null or p_monthly_rate < 0 then
    raise exception 'create_equipment_rental_batch: invalid monthly rate' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_rental_batch: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_rental_batch: end before start' using errcode = 'P0001';
  end if;

  insert into public.equipment_rental_batches
    (owner_id, monthly_rate, starts_on, ends_on, note, created_by)
  values (p_owner_id, p_monthly_rate, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_batch_create', auth.uid(), public.current_user_role(),
          'equipment_rental_batches', v_id,
          jsonb_build_object('owner_id', p_owner_id, 'monthly_rate', p_monthly_rate,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_project(p_code text, p_name text, p_project_type project_type DEFAULT NULL::project_type, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_uid  uuid := auth.uid();
  v_id   uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_project: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_project: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_project: invalid name' using errcode = '22023';
  end if;
  if p_client_id is not null
     and not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'create_project: unknown client' using errcode = '22023';
  end if;

  insert into public.projects (code, name, project_type, client_id)
  values (v_code, v_name, p_project_type, p_client_id)
  returning id into v_id;

  -- The onboarding PM joins the team. added_by = creator = self.
  insert into public.project_members (project_id, user_id, added_by)
  values (v_id, v_uid, v_uid);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid, p_eta date, p_lines jsonb, p_vat_rate numeric DEFAULT 0, p_order_ref text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supplier_name text;
  v_order_ref     text := nullif(trim(coalesce(p_order_ref, '')), '');
  v_po_id         uuid;
  v_po_number     bigint;
  v_line          jsonb;
  v_request_id    uuid;
  v_amount        numeric;
  v_request_ids   uuid[] := '{}';
  v_delivery_id   uuid;
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'create_purchase_order: role not permitted'
      using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'create_purchase_order: no lines'
      using errcode = 'P0001';
  end if;

  if v_order_ref is not null and length(v_order_ref) > 80 then
    raise exception 'create_purchase_order: order_ref longer than 80 characters'
      using errcode = 'P0001';
  end if;

  select s.name into v_supplier_name
    from public.suppliers s
   where s.id = p_supplier_id;
  if v_supplier_name is null then
    raise exception 'create_purchase_order: supplier not found'
      using errcode = 'P0001';
  end if;

  insert into public.purchase_orders
    (supplier_id, supplier, eta, ordered_at, created_by)
  values
    (p_supplier_id, v_supplier_name, p_eta, now(), auth.uid())
  returning id, po_number into v_po_id, v_po_number;

  -- Spec 135 U1: the default delivery = the whole PO (auto). Member lines join it.
  insert into public.purchase_order_deliveries (purchase_order_id, eta, created_by)
  values (v_po_id, p_eta, auth.uid())
  returning id into v_delivery_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_request_id := (v_line->>'request_id')::uuid;
    v_amount     := nullif(v_line->>'amount', '')::numeric;

    if v_amount is not null and v_amount <= 0 then
      raise exception 'create_purchase_order: amount must be positive'
        using errcode = 'P0001';
    end if;

    update public.purchase_requests
       set supplier          = v_supplier_name,
           supplier_id       = p_supplier_id,
           amount            = v_amount,
           vat_rate          = p_vat_rate,
           order_ref         = v_order_ref,
           eta               = p_eta,
           purchased_at      = now(),
           status            = 'purchased',
           purchase_order_id = v_po_id,
           delivery_id       = v_delivery_id
     where id = v_request_id
       and status = 'approved'
       and purchased_at is null;
    if not found then
      raise exception 'create_purchase_order: line % is not an approved request', v_request_id
        using errcode = 'P0001';
    end if;

    v_request_ids := v_request_ids || v_request_id;
  end loop;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'purchase_order_create', 'purchase_orders', v_po_id,
     jsonb_build_object(
       'po_number',   v_po_number,
       'supplier',    v_supplier_name,
       'supplier_id', p_supplier_id,
       'eta',         p_eta,
       'vat_rate',    p_vat_rate,
       'order_ref',   v_order_ref,
       'delivery_id', v_delivery_id,
       'line_count',  jsonb_array_length(p_lines),
       'request_ids', to_jsonb(v_request_ids)
     ));

  return v_po_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_work_package(p_project_id uuid, p_code text, p_name text, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id   uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_work_package: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_work_package: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_work_package: invalid name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_work_package: unknown project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description)
  values (p_project_id, v_code, v_name, v_desc)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_worker(p_name text, p_type worker_type, p_day_rate numeric, p_contractor uuid DEFAULT NULL::uuid, p_user uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;

  insert into public.workers (name, worker_type, contractor_id, user_id,
                              day_rate, created_by, note)
  values (v_name, p_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''))
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'worker_type', p_type,
                                   'day_rate', p_day_rate));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_contractor_bank_change(p_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.contractor_bank_change_requests%rowtype;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.dismiss_project_onboarding(p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'dismiss_project_onboarding: role not permitted' using errcode = '42501';
  end if;
  update public.projects
     set onboarding_dismissed_at = now()
   where id = p_project_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_purchase_order_delivery(p_delivery_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'dispatch_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.purchase_order_deliveries where id = p_delivery_id
  ) then
    raise exception 'dispatch_purchase_order_delivery: delivery not found'
      using errcode = 'P0001';
  end if;

  -- Mark the งวด's not-yet-shipped lines as shipped; the derive trigger flips
  -- purchased → on_route and the audit/notification triggers fire (no explicit writes
  -- here, the record_shipment posture). Already-shipped / delivered lines are left
  -- as-is, so a re-dispatch is a harmless 0-row no-op.
  update public.purchase_requests
     set shipped_at = now()
   where delivery_id = p_delivery_id
     and status = 'purchased'
     and shipped_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_peak_sync(p_entity_type peak_entity_type, p_source_table text, p_source_id uuid, p_operation peak_sync_operation DEFAULT 'create'::peak_sync_operation, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'enqueue_peak_sync: role not permitted' using errcode = '42501';
  end if;

  select id into v_id
    from public.peak_sync_outbox
   where source_table = p_source_table
     and source_id = p_source_id
     and operation = p_operation
     and status in ('pending', 'sending')
   limit 1;
  if found then
    return v_id;
  end if;

  insert into public.peak_sync_outbox (entity_type, source_table, source_id, operation, payload)
  values (p_entity_type, p_source_table, p_source_id, p_operation, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.freeze_wp_labor_cost(p_wp uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_own     numeric(12,2);
  v_dc      numeric(12,2);
  v_old_own numeric(12,2);
  v_old_dc  numeric(12,2);
begin
  -- Rate is money: pm/super only (site_admin refused, like set_worker_day_rate).
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'freeze_wp_labor_cost: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access
  -- is role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.work_packages where id = p_wp;
  if not found then
    raise exception 'freeze_wp_labor_cost: work package not found' using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) labor logs. This MUST
  -- match src/lib/labor/cost.ts aggregateLaborCost (own/dc subtotals shown
  -- in the PM cost view are computed the same way live).
  select
    coalesce(sum(case when ll.worker_type_snapshot = 'own'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0),
    coalesce(sum(case when ll.worker_type_snapshot = 'dc'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0)
  into v_own, v_dc
  from public.labor_logs ll
  where ll.work_package_id = p_wp
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  -- Prior snapshot (NULL on first freeze) for the audit payload.
  select own_cost, dc_cost into v_old_own, v_old_dc
    from public.wp_labor_costs where work_package_id = p_wp;

  insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, computed_at, frozen_by)
  values (p_wp, v_own, v_dc, now(), auth.uid())
  on conflict (work_package_id) do update
    set own_cost    = excluded.own_cost,
        dc_cost     = excluded.dc_cost,
        computed_at = excluded.computed_at,
        frozen_by   = excluded.frozen_by;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('labor_cost_freeze', auth.uid(), public.current_user_role(),
          'wp_labor_costs', p_wp,
          jsonb_build_object('own_cost', v_own, 'dc_cost', v_dc,
                             'old_own_cost', v_old_own, 'old_dc_cost', v_old_dc));
end;
$function$;

CREATE OR REPLACE FUNCTION public.gl_reconciliation()
 RETURNS TABLE(check_name text, gl_value numeric, subledger_value numeric, drift numeric, ok boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'accounting', 'project_director') then
    raise exception 'gl_reconciliation: role not permitted' using errcode = '42501';
  end if;

  return query
  with bal as (
    select a.code,
           coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)  as dr_minus_cr,
           coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)  as cr_minus_dr
      from public.gl_accounts a
      left join public.journal_lines l on l.account_id = a.id
     group by a.code
  ),
  sub as (
    select
      (select coalesce(sum(debit), 0)  from public.journal_lines) as tb_debit,
      (select coalesce(sum(credit), 0) from public.journal_lines) as tb_credit,
      (select coalesce(sum(amount_withheld), 0) from public.retention_receivables
         where status in ('held', 'due')) as retention_open,
      (select coalesce(sum(wht_amount), 0) from public.wht_certificates
         where direction = 'deducted') as wht_deducted,
      (select coalesce(sum(wht_suffered), 0) from public.client_billings
         where status in ('certified', 'invoiced', 'paid')) as wht_suffered,
      (select coalesce(sum(vat_amount), 0) from public.client_billings
         where status in ('certified', 'invoiced', 'paid')) as output_vat,
      (select count(*)::numeric from public.gl_posting_outbox
         where status in ('pending', 'failed')) as backlog
  )
  select 'trial_balance_balanced', s.tb_debit, s.tb_credit, s.tb_debit - s.tb_credit,
         s.tb_debit = s.tb_credit
    from sub s
  union all
  select 'retention_receivable_1210',
         coalesce((select dr_minus_cr from bal where code = '1210'), 0), s.retention_open,
         coalesce((select dr_minus_cr from bal where code = '1210'), 0) - s.retention_open,
         coalesce((select dr_minus_cr from bal where code = '1210'), 0) = s.retention_open
    from sub s
  union all
  select 'wht_payable_2210',
         coalesce((select cr_minus_dr from bal where code = '2210'), 0), s.wht_deducted,
         coalesce((select cr_minus_dr from bal where code = '2210'), 0) - s.wht_deducted,
         coalesce((select cr_minus_dr from bal where code = '2210'), 0) = s.wht_deducted
    from sub s
  union all
  select 'wht_prepaid_1310',
         coalesce((select dr_minus_cr from bal where code = '1310'), 0), s.wht_suffered,
         coalesce((select dr_minus_cr from bal where code = '1310'), 0) - s.wht_suffered,
         coalesce((select dr_minus_cr from bal where code = '1310'), 0) = s.wht_suffered
    from sub s
  union all
  select 'output_vat_2200',
         coalesce((select cr_minus_dr from bal where code = '2200'), 0), s.output_vat,
         coalesce((select cr_minus_dr from bal where code = '2200'), 0) - s.output_vat,
         coalesce((select cr_minus_dr from bal where code = '2200'), 0) = s.output_vat
    from sub s
  union all
  select 'posting_backlog', s.backlog, 0::numeric, s.backlog, s.backlog = 0
    from sub s;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gl_trial_balance(p_from date, p_to date, p_project_id uuid DEFAULT NULL::uuid, p_work_package_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(code text, name_th text, account_type gl_account_type, debit_total numeric, credit_total numeric, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'accounting', 'project_director') then
    raise exception 'gl_trial_balance: role not permitted' using errcode = '42501';
  end if;

  return query
    select a.code, a.name_th, a.account_type,
           coalesce(sum(l.debit), 0)::numeric,
           coalesce(sum(l.credit), 0)::numeric,
           (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::numeric
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      join public.gl_accounts a on a.id = l.account_id
     where e.entry_date between p_from and p_to
       and (p_project_id is null or l.project_id = p_project_id)
       and (p_work_package_id is null or l.work_package_id = p_work_package_id)
     group by a.code, a.name_th, a.account_type
    having coalesce(sum(l.debit), 0) <> 0 or coalesce(sum(l.credit), 0) <> 0
     order by a.code;
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_labor_day(p_wp uuid, p_worker uuid, p_date date, p_fraction day_fraction, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_worker public.workers%rowtype;
  v_wp_status public.work_package_status;
  v_id uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_wp::text || '|' || p_worker::text || '|' || p_date::text, 0));

  select status into v_wp_status
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'log_labor_day: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'log_labor_day: work package is complete'
      using errcode = 'P0001';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found then
    raise exception 'log_labor_day: worker not found' using errcode = 'P0001';
  end if;
  if not v_worker.active then
    raise exception 'log_labor_day: worker is inactive' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.labor_logs ll
     where ll.work_package_id = p_wp
       and ll.worker_id = p_worker
       and ll.work_date = p_date
       and ll.day_fraction is not null
       and not exists (select 1 from public.labor_logs newer
                        where newer.superseded_by = ll.id)
  ) then
    raise exception 'log_labor_day: entry already exists for this worker and day'
      using errcode = 'P0001';
  end if;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.worker_type,
     v_worker.contractor_id, auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_retention_due(p_id uuid, p_due_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.retention_status;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.open_accounting_period(p_month date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_id    uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'open_accounting_period: role not permitted' using errcode = '42501';
  end if;

  insert into public.accounting_periods (period_month, status)
  values (v_month, 'open')
  on conflict (period_month) do nothing
  returning id into v_id;

  -- Already existed: idempotent no-op, no audit (nothing changed).
  if v_id is null then
    select id into v_id from public.accounting_periods where period_month = v_month;
    return v_id;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('accounting_period_open', auth.uid(), public.current_user_role(),
          'accounting_periods', v_id, jsonb_build_object('period_month', v_month));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_date date, p_memo text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'post_journal_entry: role not permitted' using errcode = '42501';
  end if;
  return public.post_journal_internal(
    p_entry_date, 'manual', null, 'manual', p_memo, p_lines, null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.project_onboarding_status(p_project_id uuid)
 RETURNS TABLE(dates_lead_set boolean, budget_set boolean, team_added boolean, work_packages_added boolean, client_set boolean, dismissed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'project_onboarding_status: role not permitted' using errcode = '42501';
  end if;
  return query
    select
      (p.start_date is not null and p.project_lead_id is not null),
      (p.budget_amount_thb is not null),
      exists (select 1 from public.project_members m where m.project_id = p.id),
      exists (select 1 from public.work_packages w where w.project_id = p.id),
      (p.client_id is not null),
      (p.onboarding_dismissed_at is not null)
    from public.projects p
    where p.id = p_project_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.receive_po_lines(p_request_ids uuid[], p_received_by text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id    uuid;
  v_count integer := 0;
  v_batch uuid := gen_random_uuid();
begin
  -- Receiving is a site action (site_admin / project_manager / super_admin); the
  -- off-site purchase team can't confirm arrival.
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'receive_po_lines: role not permitted' using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'receive_po_lines: no lines' using errcode = 'P0001';
  end if;

  foreach v_id in array p_request_ids loop
    update public.purchase_requests
       set delivered_at     = now(),
           received_by      = p_received_by,
           delivery_note    = p_delivery_note,
           delivery_batch_id = v_batch
     where id = v_id
       and status in ('purchased', 'on_route');
    if not found then
      raise exception 'receive_po_lines: line % is not an in-transit member', v_id
        using errcode = 'P0001';
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_contractor_consent(p_contractor uuid, p_kind contractor_consent_kind, p_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_is_self  boolean := coalesce(public.current_user_contractor_id() = p_contractor, false);
  v_is_staff boolean := public.current_user_role() in ('site_admin', 'project_manager', 'super_admin', 'project_director');
begin
  if not (v_is_self or v_is_staff) then
    raise exception 'record_contractor_consent: not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor) then
    raise exception 'record_contractor_consent: contractor not found' using errcode = 'P0001';
  end if;
  insert into public.contractor_consents (contractor_id, kind, recorded_by, document_id)
  values (p_contractor, p_kind, auth.uid(), p_document_id)
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_dc_payment(p_contractor uuid, p_from date, p_to date, p_paid_amount numeric, p_paid_at date, p_method dc_payment_method, p_reference text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric(12,2);
  v_days   numeric(6,1);
  v_id     uuid;
begin
  -- Money: pm/super only (site_admin refused, like freeze_wp_labor_cost).
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'record_dc_payment: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access is
  -- role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.contractors where id = p_contractor;
  if not found then
    raise exception 'record_dc_payment: contractor not found' using errcode = 'P0001';
  end if;

  if p_to < p_from then
    raise exception 'record_dc_payment: period_to before period_from' using errcode = 'P0001';
  end if;
  if p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'record_dc_payment: paid_amount must be >= 0' using errcode = 'P0001';
  end if;

  -- Serialize per (contractor, period) so two concurrent records cannot both
  -- pass the duplicate guard.
  perform pg_advisory_xact_lock(hashtext(p_contractor::text || p_from::text || p_to::text));

  -- One current payment per (contractor, exact period).
  if exists (
    select 1 from public.dc_payments d
    where d.contractor_id = p_contractor
      and d.period_from = p_from
      and d.period_to = p_to
      and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id)
  ) then
    raise exception 'record_dc_payment: a payment already exists for this contractor and period'
      using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) DC labor logs for this
  -- contractor in the window. MUST match src/lib/labor/payroll.ts
  -- aggregatePayroll (the live owed shown on /payroll is computed the same way).
  select
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end)), 0),
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot), 0)
  into v_days, v_amount
  from public.labor_logs ll
  where ll.worker_type_snapshot = 'dc'
    and ll.contractor_id_snapshot = p_contractor
    and ll.work_date between p_from and p_to
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  insert into public.dc_payments (
    contractor_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, reference, note, paid_by)
  values (
    p_contractor, p_from, p_to, v_amount, v_days,
    p_paid_amount, p_paid_at, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('dc_payment_recorded', auth.uid(), public.current_user_role(),
          'dc_payments', v_id,
          jsonb_build_object('contractor_id', p_contractor,
                             'period_from', p_from, 'period_to', p_to,
                             'computed_amount', v_amount, 'computed_days', v_days,
                             'paid_amount', p_paid_amount, 'method', p_method));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_purchase(p_purchase_request_id uuid, p_supplier_id uuid, p_order_ref text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_eta date DEFAULT NULL::date, p_vat_rate numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supplier_name text;
  v_order_ref text := nullif(trim(coalesce(p_order_ref, '')), '');
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'record_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_purchase: amount must be positive'
      using errcode = 'P0001';
  end if;

  if v_order_ref is not null and length(v_order_ref) > 80 then
    raise exception 'record_purchase: order_ref longer than 80 characters'
      using errcode = 'P0001';
  end if;

  select s.name into v_supplier_name
    from public.suppliers s
   where s.id = p_supplier_id;
  if v_supplier_name is null then
    raise exception 'record_purchase: supplier not found'
      using errcode = 'P0001';
  end if;

  update public.purchase_requests
     set supplier     = v_supplier_name,
         supplier_id  = p_supplier_id,
         order_ref    = coalesce(v_order_ref, order_ref),
         amount       = coalesce(p_amount, amount),
         eta          = coalesce(p_eta, eta),
         vat_rate     = p_vat_rate,
         purchased_at = now()
   where id = p_purchase_request_id
     and status = 'approved'
     and purchased_at is null;
  if not found then
    raise exception 'record_purchase: request is not in a recordable state'
      using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_shipment(p_purchase_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'record_shipment: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set shipped_at = now()
   where id = p_purchase_request_id
     and status = 'purchased'
     and shipped_at is null;
  if not found then
    raise exception 'record_shipment: request is not in a shippable state'
      using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_site_purchase(p_work_package_id uuid, p_item_description text, p_quantity numeric, p_unit text, p_amount numeric DEFAULT NULL::numeric, p_vat_rate numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'record_site_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if v_item is null then
    raise exception 'record_site_purchase: item description required'
      using errcode = 'P0001';
  end if;
  if length(v_item) > 500 then
    raise exception 'record_site_purchase: item description too long'
      using errcode = 'P0001';
  end if;
  if v_unit is null then
    raise exception 'record_site_purchase: unit required'
      using errcode = 'P0001';
  end if;
  if length(v_unit) > 40 then
    raise exception 'record_site_purchase: unit too long'
      using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'record_site_purchase: quantity must be positive'
      using errcode = 'P0001';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_site_purchase: amount must be positive'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.work_packages wp where wp.id = p_work_package_id) then
    raise exception 'record_site_purchase: work package not found'
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit, amount, vat_rate,
     status, source, requested_by, purchased_at, delivered_at, received_by, received_by_id)
  values
    (p_work_package_id, v_item, p_quantity, v_unit, p_amount, p_vat_rate,
     'site_purchased', 'site_purchase', auth.uid(), now(), now(), v_actor, auth.uid())
  returning id into v_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'insert',
     'purchase_requests',
     v_id,
     jsonb_build_object(
       'source',           'site_purchase',
       'work_package_id',  p_work_package_id,
       'item_description', v_item,
       'quantity',         p_quantity,
       'unit',             v_unit,
       'amount',           p_amount,
       'vat_rate',         p_vat_rate,
       'received_by',      v_actor
     ));

  return v_id;
end;
$function$;

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
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.release_retention(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.retention_status;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.remove_work_package_dependency(p_predecessor uuid, p_successor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'remove_work_package_dependency: role not permitted' using errcode = '42501';
  end if;
  delete from public.work_package_dependencies
   where predecessor_id = p_predecessor and successor_id = p_successor;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_work_package_for_defect(p_wp uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.work_package_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.current_user_role();
begin
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'reopen_work_package_for_defect: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'reopen_work_package_for_defect: not a member of this project'
      using errcode = '42501';
  end if;
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'reopen_work_package_for_defect: reason required (<= 1000 chars)'
      using errcode = '22023';
  end if;

  select status into v_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'reopen_work_package_for_defect: unknown work package' using errcode = '22023';
  end if;
  if v_status <> 'complete' then
    raise exception 'reopen_work_package_for_defect: only a complete work package can be reopened'
      using errcode = '22023';
  end if;

  update public.work_packages set status = 'rework' where id = p_wp;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object('event', 'wp_reopened_for_defect', 'reason', v_reason)
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_memo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'reverse_journal_entry: role not permitted' using errcode = '42501';
  end if;
  return public.reverse_journal_internal(p_entry_id, auth.uid(), p_memo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_contractor_consent(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.contractor_consents%rowtype;
  v_is_self  boolean;
  v_is_staff boolean := public.current_user_role() in ('project_manager', 'super_admin', 'project_director');
begin
  select * into v_req from public.contractor_consents where id = p_id for update;
  if not found then
    raise exception 'revoke_contractor_consent: not found' using errcode = 'P0001';
  end if;
  v_is_self := coalesce(public.current_user_contractor_id() = v_req.contractor_id, false);
  if not (v_is_self or v_is_staff) then
    raise exception 'revoke_contractor_consent: not permitted' using errcode = '42501';
  end if;
  update public.contractor_consents set revoked_at = now() where id = p_id and revoked_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_accounting_period_status(p_month date, p_status accounting_period_status)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month    date := date_trunc('month', p_month)::date;
  v_role     text := public.current_user_role();
  v_is_super boolean := v_role = 'super_admin';
  v_old      public.accounting_period_status;
  v_id       uuid;
begin
  if v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_accounting_period_status: role not permitted' using errcode = '42501';
  end if;

  select id, status into v_id, v_old
    from public.accounting_periods where period_month = v_month;
  if v_id is null then
    raise exception 'set_accounting_period_status: period not found (open it first)'
      using errcode = 'P0001';
  end if;

  if v_old = p_status then
    raise exception 'set_accounting_period_status: already in that status' using errcode = 'P0001';
  end if;

  if not (
       (v_old = 'open'    and p_status = 'closing')
    or (v_old = 'closing' and p_status in ('open', 'closed'))
    or (v_old = 'closed'  and p_status in ('open', 'locked'))
  ) then
    raise exception 'set_accounting_period_status: illegal transition % -> %', v_old, p_status
      using errcode = 'P0001';
  end if;

  if v_old = 'closed' and p_status in ('open', 'locked') and not v_is_super then
    raise exception 'set_accounting_period_status: only super_admin may lock or reopen a closed period'
      using errcode = '42501';
  end if;

  update public.accounting_periods
     set status    = p_status,
         closed_at = case when p_status in ('closed', 'locked') then now()
                          when p_status = 'open' then null
                          else closed_at end,
         closed_by = case when p_status in ('closed', 'locked') then auth.uid()
                          when p_status = 'open' then null
                          else closed_by end
   where id = v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('accounting_period_status_change', auth.uid(), public.current_user_role(),
          'accounting_periods', v_id,
          jsonb_build_object('period_month', v_month,
                             'old_status', v_old, 'new_status', p_status));
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_contact_bank(p_contractor_id uuid DEFAULT NULL::uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_service_provider_id uuid DEFAULT NULL::uuid, p_bank_name text DEFAULT NULL::text, p_bank_account_no text DEFAULT NULL::text, p_bank_account_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_targets int := (p_contractor_id is not null)::int
                 + (p_supplier_id is not null)::int
                 + (p_service_provider_id is not null)::int;
  v_name text := nullif(btrim(p_bank_name), '');
  v_no   text := nullif(btrim(p_bank_account_no), '');
  v_acct text := nullif(btrim(p_bank_account_name), '');
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_contact_bank: role not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'set_contact_bank: exactly one target required' using errcode = 'P0001';
  end if;

  if p_contractor_id is not null then
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where contractor_id = p_contractor_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_contractor_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  elsif p_supplier_id is not null then
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where supplier_id = p_supplier_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (supplier_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_supplier_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  else
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where service_provider_id = p_service_provider_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (service_provider_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_service_provider_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_equipment_daily_rate(p_id uuid, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old numeric;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'set_equipment_daily_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_equipment_daily_rate: invalid rate' using errcode = 'P0001';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly.
  select daily_rate into v_old from public.equipment_items where id = p_id;
  if not found then
    raise exception 'set_equipment_daily_rate: equipment item not found' using errcode = 'P0001';
  end if;

  update public.equipment_items set daily_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_rate_change', auth.uid(), public.current_user_role(),
          'equipment_items', p_id,
          jsonb_build_object('kind', 'rate_change',
                             'old_rate', v_old, 'new_rate', p_rate));
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_project_client(p_project_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_project_client: role not permitted' using errcode = '42501';
  end if;
  if p_client_id is not null
     and not exists (select 1 from public.clients c where c.id = p_client_id) then
    return false;
  end if;
  update public.projects set client_id = p_client_id where id = p_project_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_purchase_request_notes(p_id uuid, p_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Back-office may edit any request's note; anyone else only their own.
  if public.current_user_role() not in ('project_manager', 'procurement', 'super_admin', 'project_director')
     and not exists (
       select 1 from public.purchase_requests pr
       where pr.id = p_id and pr.requested_by = auth.uid()
     ) then
    raise exception 'set_purchase_request_notes: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set notes = nullif(btrim(p_notes), '')
   where id = p_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_contractor(p_work_package_id uuid, p_contractor_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_contractor: role not permitted'
      using errcode = '42501';
  end if;

  if p_contractor_id is not null
     and not exists (select 1 from public.contractors c where c.id = p_contractor_id) then
    return false;
  end if;

  update public.work_packages
     set contractor_id = p_contractor_id
   where id = p_work_package_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_notes(p_work_package_id uuid, p_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_notes: role not permitted'
      using errcode = '42501';
  end if;

  update public.work_packages
     set notes = nullif(btrim(p_notes), '')
   where id = p_work_package_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_priority(p_work_package_id uuid, p_priority work_package_priority)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_priority: role not permitted'
      using errcode = '42501';
  end if;

  update public.work_packages
     set priority = p_priority
   where id = p_work_package_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_schedule(p_work_package_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_schedule: role not permitted' using errcode = '42501';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    return false;
  end if;
  update public.work_packages
     set planned_start = p_start, planned_end = p_end
   where id = p_work_package_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_worker_day_rate(p_id uuid, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old numeric;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_worker_day_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_worker_day_rate: invalid rate' using errcode = 'P0001';
  end if;
  select day_rate into v_old from public.workers where id = p_id;
  if not found then
    raise exception 'set_worker_day_rate: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set day_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'rate_change',
                                   'old_rate', v_old, 'new_rate', p_rate));
end;
$function$;

CREATE OR REPLACE FUNCTION public.split_purchase_order_delivery(p_purchase_order_id uuid, p_request_ids uuid[], p_eta date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_cost numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_delivery_id uuid;
  v_count       int;
  v_source      record;
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin', 'project_director') then
    raise exception 'split_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'split_purchase_order_delivery: no lines selected'
      using errcode = 'P0001';
  end if;

  if p_cost is not null and p_cost < 0 then
    raise exception 'split_purchase_order_delivery: cost must be >= 0'
      using errcode = 'P0001';
  end if;

  -- Lock the selected rows first (a separate statement — FOR UPDATE is not allowed
  -- with an aggregate), so a concurrent split can't move the same line twice.
  perform 1
    from public.purchase_requests
   where id = any(p_request_ids)
   for update;

  -- Every selected id must be a distinct in-transit member of THIS PO. A count
  -- mismatch catches a non-member, an already-received (delivered) line, a
  -- rejected/cancelled line, and a duplicate id in one check.
  select count(*) into v_count
    from public.purchase_requests
   where id = any(p_request_ids)
     and purchase_order_id = p_purchase_order_id
     and status in ('purchased', 'on_route');

  if v_count <> array_length(p_request_ids, 1) then
    raise exception
      'split_purchase_order_delivery: every line must be an in-transit member of the PO'
      using errcode = 'P0001';
  end if;

  -- Non-empty guard: each source delivery the selection draws from must keep >= 1
  -- active (non rejected/cancelled) line after the move. A delivered line counts —
  -- it keeps the delivery alive even when all its in-transit lines move out.
  for v_source in
    select distinct delivery_id
      from public.purchase_requests
     where id = any(p_request_ids)
  loop
    if (select count(*)
          from public.purchase_requests r
         where r.delivery_id = v_source.delivery_id
           and r.status not in ('rejected', 'cancelled')
           and not (r.id = any(p_request_ids))) = 0 then
      raise exception
        'split_purchase_order_delivery: a source delivery cannot be emptied by the split'
        using errcode = 'P0001';
    end if;
  end loop;

  insert into public.purchase_order_deliveries
    (purchase_order_id, eta, note, cost, created_by)
  values
    (p_purchase_order_id, p_eta, nullif(trim(coalesce(p_note, '')), ''), p_cost, auth.uid())
  returning id into v_delivery_id;

  update public.purchase_requests
     set delivery_id = v_delivery_id
   where id = any(p_request_ids);

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(),
     'update', 'purchase_order_deliveries', v_delivery_id,
     jsonb_build_object(
       'principal',         session_user,
       'transition',        jsonb_build_array('delivery_split'),
       'purchase_order_id', p_purchase_order_id,
       'delivery_id',       v_delivery_id,
       'request_ids',       to_jsonb(p_request_ids),
       'line_count',        array_length(p_request_ids, 1),
       'eta',               p_eta,
       'cost',              p_cost
     ));

  return v_delivery_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.split_purchase_request_on_receipt(p_request_id uuid, p_received_qty numeric, p_received_by text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text, p_delivered_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig          public.purchase_requests%rowtype;
  v_remaining_qty numeric;
  v_delivered_amt numeric;
  v_remaining_amt numeric;
  v_child_id      uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'split_purchase_request_on_receipt: role not permitted'
      using errcode = '42501';
  end if;

  select * into v_orig
    from public.purchase_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception 'split_purchase_request_on_receipt: request not found'
      using errcode = 'P0001';
  end if;

  if v_orig.purchase_order_id is null
     or v_orig.status not in ('purchased', 'on_route') then
    raise exception
      'split_purchase_request_on_receipt: not an in-transit PO member (status %)', v_orig.status
      using errcode = 'P0001';
  end if;

  if p_received_qty is null or p_received_qty <= 0 or p_received_qty >= v_orig.quantity then
    raise exception
      'split_purchase_request_on_receipt: received qty must be > 0 and < ordered (%)', v_orig.quantity
      using errcode = 'P0001';
  end if;

  v_remaining_qty := v_orig.quantity - p_received_qty;

  if v_orig.amount is null then
    v_delivered_amt := null;
    v_remaining_amt := null;
  elsif p_delivered_amount is not null then
    if p_delivered_amount < 0 or p_delivered_amount > v_orig.amount then
      raise exception
        'split_purchase_request_on_receipt: delivered amount out of range (0..%)', v_orig.amount
        using errcode = 'P0001';
    end if;
    v_delivered_amt := p_delivered_amount;
    v_remaining_amt := v_orig.amount - p_delivered_amount;
  else
    v_delivered_amt := round(v_orig.amount * p_received_qty / v_orig.quantity, 2);
    v_remaining_amt := v_orig.amount - v_delivered_amt;
  end if;

  -- The remainder child stays in the SAME delivery as the original (ADR 0054 §7).
  insert into public.purchase_requests (
    work_package_id, item_description, quantity, unit, status, source,
    requested_by, requested_by_email, approved_by, decided_at, decision_comment,
    supplier, supplier_id, order_ref, amount, purchased_at, shipped_at,
    eta, needed_by, priority, notes, purchase_order_id, delivery_id, split_from_request_id
  )
  values (
    v_orig.work_package_id, v_orig.item_description, v_remaining_qty, v_orig.unit,
    'on_route', v_orig.source,
    v_orig.requested_by, v_orig.requested_by_email, v_orig.approved_by, v_orig.decided_at,
    v_orig.decision_comment, v_orig.supplier, v_orig.supplier_id, v_orig.order_ref,
    v_remaining_amt, v_orig.purchased_at, coalesce(v_orig.shipped_at, now()),
    v_orig.eta, v_orig.needed_by, v_orig.priority, v_orig.notes,
    v_orig.purchase_order_id, v_orig.delivery_id, p_request_id
  )
  returning id into v_child_id;

  update public.purchase_requests
     set quantity         = p_received_qty,
         amount           = v_delivered_amt,
         delivered_at     = now(),
         received_by      = p_received_by,
         delivery_note    = p_delivery_note,
         delivery_batch_id = gen_random_uuid()
   where id = p_request_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(), 'update', 'purchase_requests', p_request_id,
     jsonb_build_object(
       'principal',         session_user,
       'transition',        jsonb_build_array('partial_receipt_split'),
       'split_child_id',    v_child_id,
       'ordered_qty',       v_orig.quantity,
       'received_qty',      p_received_qty,
       'remaining_qty',     v_remaining_qty,
       'delivered_amount',  v_delivered_amt,
       'remaining_amount',  v_remaining_amt,
       'purchase_order_id', v_orig.purchase_order_id
     ));

  return v_child_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.suggest_project_code()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_max  int;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'suggest_project_code: role not permitted' using errcode = '42501';
  end if;
  select coalesce(max(substring(code from '^PRC-' || v_year || '-([0-9]+)$')::int), 0)
    into v_max
    from public.projects
   where code ~ ('^PRC-' || v_year || '-[0-9]+$');
  return 'PRC-' || v_year || '-' || lpad((v_max + 1)::text, 3, '0');
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_project_settings(p_project_id uuid, p_name text, p_status project_status, p_notes text DEFAULT NULL::text, p_site_address text DEFAULT NULL::text, p_planned_completion_date date DEFAULT NULL::date, p_budget_amount_thb numeric DEFAULT NULL::numeric, p_start_date date DEFAULT NULL::date, p_project_lead_id uuid DEFAULT NULL::uuid, p_project_type project_type DEFAULT NULL::project_type)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'update_project_settings: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'update_project_settings: invalid name' using errcode = '22023';
  end if;
  if p_planned_completion_date is not null and p_planned_completion_date < current_date then
    raise exception 'update_project_settings: completion date cannot be past' using errcode = '22023';
  end if;
  if p_budget_amount_thb is not null and p_budget_amount_thb < 0 then
    raise exception 'update_project_settings: budget cannot be negative' using errcode = '22023';
  end if;
  if p_project_lead_id is not null
     and not exists (select 1 from public.users u where u.id = p_project_lead_id) then
    raise exception 'update_project_settings: unknown project lead' using errcode = '22023';
  end if;

  update public.projects
     set name   = v_name,
         status = p_status,
         notes  = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
         site_address = case when p_site_address is null then site_address
                             else nullif(btrim(p_site_address), '') end,
         start_date              = coalesce(p_start_date, start_date),
         planned_completion_date = coalesce(p_planned_completion_date, planned_completion_date),
         project_lead_id         = coalesce(p_project_lead_id, project_lead_id),
         project_type            = coalesce(p_project_type, project_type),
         budget_amount_thb       = coalesce(p_budget_amount_thb, budget_amount_thb)
   where id = p_project_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_worker(p_id uuid, p_name text DEFAULT NULL::text, p_active boolean DEFAULT NULL::boolean, p_contractor uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_contractor is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: contractor only applies to dc workers'
      using errcode = 'P0001';
  end if;

  -- Coalesce semantics (record_purchase precedent): omitted = preserved.
  -- The note uses case-preserve so an explicit '' can clear it.
  update public.workers
     set name          = coalesce(v_name, name),
         active        = coalesce(p_active, active),
         contractor_id = coalesce(p_contractor, contractor_id),
         note          = case
                           when p_note is null then note
                           else nullif(btrim(p_note), '')
                         end
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'contractor_id', p_contractor));
end;
$function$;

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
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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
