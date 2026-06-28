-- Architecture-quality audit rank 5 (sql-role-helpers), stage 2 — batch 4 (is_back_office).
--
-- Adopt the SSOT predicate public.is_back_office() (migration 20260813003200) in
-- the inline back-office gate of these exact PM-3+procurement RPCs. Each gate
--   current_user_role() not in (<project_manager, super_admin, procurement, project_director, any order>)
-- becomes
--   not public.is_back_office(public.current_user_role())
-- the SQL counterpart of BACK_OFFICE_ROLES (src/lib/auth/role-home.ts).
--
-- BEHAVIOUR-PRESERVING: is_back_office(role) is exactly that four-role set and
-- pgTAP 231 asserts TS<->SQL parity, so access is unchanged. Role ORDER varies
-- per function, so the generator parses each gate's role SET and swaps only the
-- exact match (one per function, asserted). Bodies sourced VERBATIM from LIVE via
-- pg_get_functiondef; CREATE OR REPLACE preserves grants (anon revoked; pgTAP 229).
--
-- EXCLUDED (deferred to post-#160): the spec-219-coupled catalog RPCs
-- create/update_catalog_item + create/update_catalog_subcategory, whose current
-- definition lives in the held migration 015000.
--
-- Functions (19): add_purchase_quote, add_supply_plan_line, add_supply_plan_lines, create_supply_plan, create_worker, create_worker_invite, delete_supply_plan, generate_purchase_requests_from_plan, item_price_history, record_dc_payment, remove_purchase_quote, remove_supply_plan_line, set_catalog_item_active, set_catalog_item_image, set_contact_bank, set_purchase_request_notes, set_worker_day_rate, submit_supply_plan, update_worker.

-- add_purchase_quote
CREATE OR REPLACE FUNCTION public.add_purchase_quote(p_purchase_request_id uuid, p_supplier_id uuid, p_unit_price numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.purchase_request_status;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_id     uuid;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'add_purchase_quote: role not permitted' using errcode = '42501';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'add_purchase_quote: unit_price must be >= 0' using errcode = '22023';
  end if;
  select pr.status into v_status from public.purchase_requests pr where pr.id = p_purchase_request_id;
  if v_status is null then
    raise exception 'add_purchase_quote: unknown purchase request' using errcode = '22023';
  end if;
  if v_status <> 'approved' then
    raise exception 'add_purchase_quote: the request must be approved (awaiting purchase)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id) then
    raise exception 'add_purchase_quote: unknown supplier' using errcode = '22023';
  end if;
  insert into public.purchase_quotes (purchase_request_id, supplier_id, unit_price, note)
  values (p_purchase_request_id, p_supplier_id, p_unit_price, v_note)
  returning id into v_id;
  return v_id;
end;
$function$;

-- add_supply_plan_line
CREATE OR REPLACE FUNCTION public.add_supply_plan_line(p_plan_id uuid, p_catalog_item_id uuid, p_work_package_id uuid, p_qty numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'add_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_line: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  -- Editable while draft OR rejected; submitted/approved are frozen.
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'add_supply_plan_line: qty must be > 0' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.catalog_items c where c.id = p_catalog_item_id and c.is_active
  ) then
    raise exception 'add_supply_plan_line: unknown or inactive catalog item' using errcode = '22023';
  end if;
  if p_work_package_id is not null and not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = v_project_id
  ) then
    raise exception 'add_supply_plan_line: work package not in this project' using errcode = '22023';
  end if;

  insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
  values (p_plan_id, p_catalog_item_id, p_work_package_id, p_qty, v_note)
  returning id into v_id;

  return v_id;
end;
$function$;

-- add_supply_plan_lines
CREATE OR REPLACE FUNCTION public.add_supply_plan_lines(p_plan_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
  v_line       jsonb;
  v_item       uuid;
  v_wp         uuid;
  v_qty        numeric;
  v_note       text;
  v_count      int := 0;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'add_supply_plan_lines: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_lines: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_lines: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_lines: plan is not editable' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'add_supply_plan_lines: lines must be a json array' using errcode = '22023';
  end if;

  -- Atomic: validate + insert every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line ->> 'catalog_item_id')::uuid;
    v_wp   := nullif(v_line ->> 'work_package_id', '')::uuid;
    v_qty  := (v_line ->> 'qty')::numeric;
    v_note := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'add_supply_plan_lines: qty must be > 0' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.catalog_items c where c.id = v_item and c.is_active
    ) then
      raise exception 'add_supply_plan_lines: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_wp is not null and not exists (
      select 1 from public.work_packages w
       where w.id = v_wp and w.project_id = v_project_id
    ) then
      raise exception 'add_supply_plan_lines: work package not in this project' using errcode = '22023';
    end if;

    insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
    values (p_plan_id, v_item, v_wp, v_qty, v_note);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- create_supply_plan
CREATE OR REPLACE FUNCTION public.create_supply_plan(p_project_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_supply_plan: role not permitted' using errcode = '42501';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(p_project_id) then
    raise exception 'create_supply_plan: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_supply_plan: unknown project' using errcode = '22023';
  end if;
  insert into public.supply_plans (project_id) values (p_project_id) returning id into v_id;
  return v_id;
end;
$function$;

-- create_worker
CREATE OR REPLACE FUNCTION public.create_worker(p_name text, p_type worker_type, p_day_rate numeric, p_contractor uuid DEFAULT NULL::uuid, p_user uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_arrangement dc_arrangement DEFAULT NULL::dc_arrangement, p_phone text DEFAULT NULL::text, p_tax_id text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_account_number text DEFAULT NULL::text, p_bank_account_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;
  if p_arrangement is not null and p_type <> 'dc' then
    raise exception 'create_worker: arrangement only applies to dc workers'
      using errcode = 'P0001';
  end if;

  insert into public.workers (name, worker_type, contractor_id, user_id,
                              day_rate, created_by, note, dc_arrangement,
                              phone, tax_id, bank_name, bank_account_number,
                              bank_account_name)
  values (v_name, p_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''), p_arrangement,
          nullif(btrim(p_phone), ''), nullif(btrim(p_tax_id), ''),
          nullif(btrim(p_bank_name), ''), nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''))
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'worker_type', p_type,
                                   'day_rate', p_day_rate,
                                   'dc_arrangement', p_arrangement));
  return v_id;
end;
$function$;

-- create_worker_invite
CREATE OR REPLACE FUNCTION public.create_worker_invite(p_worker uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
  v_type  public.worker_type;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_worker_invite: role not permitted' using errcode = '42501';
  end if;
  select worker_type into v_type from public.workers where id = p_worker;
  if not found then
    raise exception 'create_worker_invite: worker not found' using errcode = 'P0001';
  end if;
  if v_type <> 'dc' then
    raise exception 'create_worker_invite: portal invites are for dc workers' using errcode = 'P0001';
  end if;
  -- 64-char hex token (gen_random_uuid is guaranteed present; gen_random_bytes is not).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token, created_by, expires_at)
  values (p_worker, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

-- delete_supply_plan
CREATE OR REPLACE FUNCTION public.delete_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'delete_supply_plan: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'delete_supply_plan: unknown plan' using errcode = '22023';
  end if;

  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'delete_supply_plan: not a project member' using errcode = '42501';
  end if;

  -- Only an editable plan may be deleted; submitted/approved are frozen.
  if v_status not in ('draft', 'rejected') then
    raise exception 'delete_supply_plan: only a draft/rejected plan can be deleted'
      using errcode = '22023';
  end if;

  delete from public.supply_plans where id = p_plan_id;
end;
$function$;

-- generate_purchase_requests_from_plan
CREATE OR REPLACE FUNCTION public.generate_purchase_requests_from_plan(p_plan_id uuid, p_line_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_approved_by uuid;
  v_line        record;
  v_count       int := 0;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'generate_purchase_requests_from_plan: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.approved_by
    into v_project_id, v_status, v_approved_by
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'generate_purchase_requests_from_plan: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'generate_purchase_requests_from_plan: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'approved' then
    raise exception 'generate_purchase_requests_from_plan: plan must be approved first' using errcode = '22023';
  end if;
  if p_line_ids is null or array_length(p_line_ids, 1) is null then
    raise exception 'generate_purchase_requests_from_plan: no lines selected' using errcode = '22023';
  end if;

  for v_line in
    select l.id, l.work_package_id, l.catalog_item_id, l.qty,
           c.base_item, c.spec_attrs, c.unit
      from public.supply_plan_lines l
      join public.catalog_items c on c.id = l.catalog_item_id
     where l.supply_plan_id = p_plan_id and l.id = any (p_line_ids)
  loop
    -- Idempotent: a line already converted is skipped (the unique index also guards).
    if exists (
      select 1 from public.purchase_requests pr where pr.supply_plan_line_id = v_line.id
    ) then
      continue;
    end if;

    insert into public.purchase_requests (
      work_package_id, project_id, catalog_item_id, item_description, quantity, unit,
      status, source, requested_by, approved_by, decided_at,
      supply_plan_line_id
    ) values (
      -- Spec 208 U4a / ADR 0065: store-only — every generated PR is store-bound.
      -- The plan line's WP is a planning dimension; the PR is WP-less and the
      -- material is เบิก'd to a WP after it is received into the store.
      null,
      v_project_id,             -- the plan's project (store identity)
      v_line.catalog_item_id,   -- force-catalog: snapshotted by the receive trigger
      v_line.base_item || coalesce(' ' || v_line.spec_attrs, ''),
      v_line.qty,
      v_line.unit,
      'approved',          -- born approved: inherits the plan's PD approval
      'app',
      auth.uid(),          -- the generating user (procurement / PM)
      v_approved_by,       -- the PD who approved the plan
      now(),
      v_line.id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- item_price_history
CREATE OR REPLACE FUNCTION public.item_price_history(p_catalog_item_id uuid)
 RETURNS TABLE(supplier_name text, net_unit_price numeric, quantity numeric, purchased_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'item_price_history: role not permitted' using errcode = '42501';
  end if;

  return query
  select
    coalesce(s.name, pr.supplier)                                            as supplier_name,
    round((pr.amount / (1 + pr.vat_rate / 100.0)) / nullif(pr.quantity, 0), 2) as net_unit_price,
    pr.quantity                                                              as quantity,
    pr.purchased_at                                                          as purchased_at
  from public.purchase_requests pr
  left join public.suppliers s on s.id = pr.supplier_id
  where pr.catalog_item_id = p_catalog_item_id
    and pr.amount is not null
    and pr.quantity > 0
  order by coalesce(pr.purchased_at, pr.requested_at) desc
  limit 5;
end;
$function$;

-- record_dc_payment
CREATE OR REPLACE FUNCTION public.record_dc_payment(p_worker uuid, p_from date, p_to date, p_paid_amount numeric, p_paid_at date, p_method dc_payment_method, p_reference text, p_note text)
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
  -- Money: pm/super/director/procurement only (site_admin refused, like
  -- freeze_wp_labor_cost). Spec 187 adds procurement (project-director parity on
  -- payroll); project_director rides along per spec 152 / ADR 0058.
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'record_dc_payment: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access is
  -- role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.workers where id = p_worker;
  if not found then
    raise exception 'record_dc_payment: worker not found' using errcode = 'P0001';
  end if;

  if p_to < p_from then
    raise exception 'record_dc_payment: period_to before period_from' using errcode = 'P0001';
  end if;
  if p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'record_dc_payment: paid_amount must be >= 0' using errcode = 'P0001';
  end if;

  -- Serialize per (worker, period) so two concurrent records cannot both
  -- pass the duplicate guard.
  perform pg_advisory_xact_lock(hashtext(p_worker::text || p_from::text || p_to::text));

  -- One current payment per (worker, exact period).
  if exists (
    select 1 from public.dc_payments d
    where d.worker_id = p_worker
      and d.period_from = p_from
      and d.period_to = p_to
      and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id)
  ) then
    raise exception 'record_dc_payment: a payment already exists for this worker and period'
      using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) DC labor logs for this
  -- worker in the window. MUST match src/lib/labor/payroll.ts aggregatePayroll
  -- (the live owed shown on /payroll is computed the same way).
  select
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end)), 0),
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot), 0)
  into v_days, v_amount
  from public.labor_logs ll
  where ll.worker_type_snapshot = 'dc'
    and ll.worker_id = p_worker
    and ll.work_date between p_from and p_to
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  insert into public.dc_payments (
    worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, reference, note, paid_by)
  values (
    p_worker, p_from, p_to, v_amount, v_days,
    p_paid_amount, p_paid_at, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('dc_payment_recorded', auth.uid(), public.current_user_role(),
          'dc_payments', v_id,
          jsonb_build_object('worker_id', p_worker,
                             'period_from', p_from, 'period_to', p_to,
                             'computed_amount', v_amount, 'computed_days', v_days,
                             'paid_amount', p_paid_amount, 'method', p_method));
  return v_id;
end;
$function$;

-- remove_purchase_quote
CREATE OR REPLACE FUNCTION public.remove_purchase_quote(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'remove_purchase_quote: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.purchase_quotes q where q.id = p_quote_id) then
    raise exception 'remove_purchase_quote: unknown quote' using errcode = '22023';
  end if;
  delete from public.purchase_quotes where id = p_quote_id;
end;
$function$;

-- remove_supply_plan_line
CREATE OR REPLACE FUNCTION public.remove_supply_plan_line(p_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'remove_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plan_lines l
    join public.supply_plans sp on sp.id = l.supply_plan_id
   where l.id = p_line_id;
  if v_project_id is null then
    raise exception 'remove_supply_plan_line: unknown line' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$function$;

-- set_catalog_item_active
CREATE OR REPLACE FUNCTION public.set_catalog_item_active(p_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n integer;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'set_catalog_item_active: role not permitted' using errcode = '42501';
  end if;

  update public.catalog_items
     set is_active = coalesce(p_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_catalog_item_active: unknown item' using errcode = '22023';
  end if;
end;
$function$;

-- set_catalog_item_image
CREATE OR REPLACE FUNCTION public.set_catalog_item_image(p_id uuid, p_image_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_path text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_n    integer;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'set_catalog_item_image: role not permitted' using errcode = '42501';
  end if;
  if v_path is not null and length(v_path) > 300 then
    raise exception 'set_catalog_item_image: path too long' using errcode = '22023';
  end if;

  update public.catalog_items set image_path = v_path where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_catalog_item_image: unknown item' using errcode = '22023';
  end if;
end;
$function$;

-- set_contact_bank
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
  if not public.is_back_office(public.current_user_role()) then
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

-- set_purchase_request_notes
CREATE OR REPLACE FUNCTION public.set_purchase_request_notes(p_id uuid, p_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Back-office may edit any request's note; anyone else only their own.
  if not public.is_back_office(public.current_user_role())
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

-- set_worker_day_rate
CREATE OR REPLACE FUNCTION public.set_worker_day_rate(p_id uuid, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old numeric;
begin
  if not public.is_back_office(public.current_user_role()) then
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

-- submit_supply_plan
CREATE OR REPLACE FUNCTION public.submit_supply_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'submit_supply_plan: role not permitted' using errcode = '42501';
  end if;
  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'submit_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'submit_supply_plan: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'submit_supply_plan: only a draft/rejected plan can be submitted' using errcode = '22023';
  end if;

  update public.supply_plans
     set status = 'submitted', submitted_at = now()
   where id = p_plan_id;
end;
$function$;

-- update_worker
CREATE OR REPLACE FUNCTION public.update_worker(p_id uuid, p_name text DEFAULT NULL::text, p_active boolean DEFAULT NULL::boolean, p_contractor uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_arrangement dc_arrangement DEFAULT NULL::dc_arrangement, p_phone text DEFAULT NULL::text, p_tax_id text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_account_number text DEFAULT NULL::text, p_bank_account_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_back_office(public.current_user_role()) then
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
  if p_arrangement is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: arrangement only applies to dc workers'
      using errcode = 'P0001';
  end if;

  -- Coalesce semantics (record_purchase precedent): omitted = preserved.
  -- The note uses case-preserve so an explicit '' can clear it; the payee
  -- text fields coalesce (edit replaces, omit preserves).
  update public.workers
     set name                = coalesce(v_name, name),
         active              = coalesce(p_active, active),
         contractor_id       = coalesce(p_contractor, contractor_id),
         dc_arrangement      = coalesce(p_arrangement, dc_arrangement),
         phone               = coalesce(nullif(btrim(p_phone), ''), phone),
         tax_id              = coalesce(nullif(btrim(p_tax_id), ''), tax_id),
         bank_name           = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
         bank_account_number = coalesce(nullif(btrim(p_bank_account_number), ''), bank_account_number),
         bank_account_name   = coalesce(nullif(btrim(p_bank_account_name), ''), bank_account_name),
         note                = case
                                 when p_note is null then note
                                 else nullif(btrim(p_note), '')
                               end
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'contractor_id', p_contractor,
                                   'dc_arrangement', p_arrangement));
end;
$function$;
