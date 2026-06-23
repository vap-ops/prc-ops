-- Spec 178 B7 / ADR 0057 dec 11 — add the Inventory (1500) ↔ stock_on_hand tie to
-- gl_reconciliation. The store GL (B6) gave 1500 exactly one feeder (store
-- movements), so unlike the multi-feeder AP 2100 / WIP 1400 it CAN reconcile to its
-- subledger: the GL 1500 balance (dr−cr) must equal Σ stock_on_hand.total_value
-- once the posting backlog is clear (GL posts async vs the synchronous on-hand) —
-- the posting_backlog check already surfaces an in-flight lag. Catches any
-- store-posting bug (a drift means the books and the physical stock ledger diverge).
--
-- CREATE OR REPLACE the NO-ARG gl_reconciliation() (the one the app + /accounting
-- call; a stale 2-arg (date,date) overload from mig 748 also exists but is unused).
-- Body sourced from the LIVE no-arg proc (mig 749) + one sub field + one UNION arm
-- (the source-from-LIVE discipline — same return shape, grants preserved).

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
  -- Gate sourced from the LIVE proc (mig 20260751 added project_director — the
  -- ADR-0058 invariant pgTAP 90 pins; mig 749's body predates it, so do NOT copy 749).
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'accounting', 'project_director') then
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
$$;

revoke all on function public.gl_reconciliation() from public, anon;
grant execute on function public.gl_reconciliation() to authenticated;
