-- Spec 149 U9 / ADR 0057 — widen the read-only GL reporting RPCs to admit the
-- `accounting` role (the dedicated reader onboarded at /accounting). pm/super stay.
-- Bodies identical to 20260748000000; only the role gate changes.

create or replace function public.gl_trial_balance(
  p_from            date,
  p_to              date,
  p_project_id      uuid default null,
  p_work_package_id uuid default null
)
returns table (
  code         text,
  name_th      text,
  account_type public.gl_account_type,
  debit_total  numeric,
  credit_total numeric,
  balance      numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'accounting') then
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
$$;

create or replace function public.gl_reconciliation()
returns table (
  check_name       text,
  gl_value         numeric,
  subledger_value  numeric,
  drift            numeric,
  ok               boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'accounting') then
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
$$;
