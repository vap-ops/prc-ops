-- rls-audit-2026-07 Pass B / M-B2 accounting / GL / price-setting — null-safe SECURITY DEFINER role gates (F1).
-- gl_trial_balance, gl_reconciliation, open_accounting_period, set_accounting_period_status, set_item_sell_rate.
-- Each body is VERBATIM from LIVE (pg_get_functiondef, 2026-07-02) with ONE
-- mechanical edit per gate: a NULL role now fails the gate closed instead of
-- falling through (bare `not in` / `v_role not in` / `<>` / `= any` /
-- `v_is_staff := role in` forms all get an `is null`/`coalesce(...,false)`
-- guard). Real roles behave identically. All CREATE OR REPLACE (no signature
-- change) → grants preserved, no db:types drift, no pin churn.

CREATE OR REPLACE FUNCTION public.gl_trial_balance(p_from date, p_to date, p_project_id uuid DEFAULT NULL::uuid, p_work_package_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(code text, name_th text, account_type gl_account_type, debit_total numeric, credit_total numeric, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'accounting', 'project_director') then
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

CREATE OR REPLACE FUNCTION public.gl_reconciliation()
 RETURNS TABLE(check_name text, gl_value numeric, subledger_value numeric, drift numeric, ok boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Gate sourced from the LIVE proc (mig 20260751 added project_director — the
  -- ADR-0058 invariant pgTAP 90 pins; mig 749's body predates it, so do NOT copy 749).
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'accounting', 'project_director') then
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
      -- Spec 178 B7 — the perpetual inventory subledger (store on-hand, at cost).
      (select coalesce(sum(total_value), 0) from public.stock_on_hand) as inventory_onhand,
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
  -- Spec 178 B7 — Inventory 1500 (dr−cr) ties to the on-hand subledger.
  select 'inventory_1500',
         coalesce((select dr_minus_cr from bal where code = '1500'), 0), s.inventory_onhand,
         coalesce((select dr_minus_cr from bal where code = '1500'), 0) - s.inventory_onhand,
         coalesce((select dr_minus_cr from bal where code = '1500'), 0) = s.inventory_onhand
    from sub s
  union all
  select 'posting_backlog', s.backlog, 0::numeric, s.backlog, s.backlog = 0
    from sub s;
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
  if public.current_user_role() is null
     or public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'accounting') then
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
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director', 'accounting') then
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

CREATE OR REPLACE FUNCTION public.set_item_sell_rate(p_catalog_item_id uuid, p_sell_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old numeric;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('super_admin', 'project_director') then
    raise exception 'set_item_sell_rate: role not permitted' using errcode = '42501';
  end if;
  if p_sell_rate is null or p_sell_rate < 0 then
    raise exception 'set_item_sell_rate: rate must be non-negative' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'set_item_sell_rate: unknown catalog item' using errcode = '22023';
  end if;

  select sell_rate into v_old from public.item_sell_rates
   where catalog_item_id = p_catalog_item_id;

  insert into public.item_sell_rates (catalog_item_id, sell_rate, updated_by, updated_at)
  values (p_catalog_item_id, p_sell_rate, auth.uid(), now())
  on conflict (catalog_item_id) do update
    set sell_rate = excluded.sell_rate, updated_by = excluded.updated_by, updated_at = now();

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'item_sell_rates',
          p_catalog_item_id,
          jsonb_build_object('entity', 'item_sell_rate', 'old', v_old, 'new', p_sell_rate));
end;
$function$;
