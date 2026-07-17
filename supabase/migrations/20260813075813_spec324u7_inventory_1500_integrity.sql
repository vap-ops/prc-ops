-- Spec 324 U7 — the inventory_1500 tie in the scheduled integrity registry.
--
-- The pre-existing 1500 drift (the 200-store known-red) is FULLY EXPLAINED: PO-level
-- purchase_order_charges (transport freight + supplier discounts) post to GL account
-- 1500 (Inventory) but never flow into the moving-average store pool
-- (stock_on_hand.total_value). Verified org-wide 2026-07-17: GL 1500 (1,898,512.28) =
-- Σ on-hand (1,900,018.86) + Σ po_charge net on 1500 (-1,506.58) → residual 0.00.
--
-- So the sound tie is GL 1500 = Σ stock_on_hand.total_value + Σ(po_charge on 1500).
-- This makes BOTH the on-demand gl_reconciliation() (un-pins the 200-store known-red)
-- and the scheduled _integrity_check_results() (spec 324 U7 deliverable) PO-charge-
-- aware. Both bodies sourced VERBATIM from LIVE (mig 20260748.../20260813075470) with
-- only the named edits. gl_value stays the RAW 1500 balance (honest); the capitalized
-- PO charges are carried on the subledger side.
--
-- The scheduled check is PENDING-gated (skip only while postings are in flight); a
-- FAILED posting is deliberately NOT skipped (that is a real, standing gap the other
-- outbox checks already flag).

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
      (select coalesce(sum(l.debit - l.credit), 0)
         from public.journal_lines l
         join public.journal_entries e on e.id = l.entry_id
         join public.gl_accounts a on a.id = l.account_id
        where a.code = '1500' and e.source_table = 'purchase_order_charges') as po_charge_1500,
      -- Spec 324 U7: pending 1500-affecting postings (in flight → the tie is
      -- momentarily broken while the drain catches up; a FAILED row is NOT skipped).
      (select count(*)::numeric from public.gl_posting_outbox
         where status = 'pending'
           and source_table in ('stock_receipts', 'stock_issues', 'stock_returns',
                                 'stock_counts', 'stock_reversals',
                                 'stock_receipt_corrections', 'purchase_order_charges')) as inv_pending,
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
  -- Spec 324 U7: subledger = on-hand pool + capitalized PO charges (freight/discount
  -- post to 1500 but not the pool). ok/drift pending-gated (green while 1500-affecting
  -- postings drain), so the interactive tie does not flash a transient in-flight break.
  select 'inventory_1500',
         coalesce((select dr_minus_cr from bal where code = '1500'), 0), (s.inventory_onhand + s.po_charge_1500),
         case when s.inv_pending > 0 then 0
              else coalesce((select dr_minus_cr from bal where code = '1500'), 0) - (s.inventory_onhand + s.po_charge_1500) end,
         case when s.inv_pending > 0 then true
              else coalesce((select dr_minus_cr from bal where code = '1500'), 0) = (s.inventory_onhand + s.po_charge_1500) end
    from sub s
  union all
  select 'posting_backlog', s.backlog, 0::numeric, s.backlog, s.backlog = 0
    from sub s;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._integrity_check_results()
 RETURNS TABLE(key text, domain text, title text, severity text, status text, drift numeric, offending_count integer, sample jsonb, implemented boolean, unit text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- the RETURNS TABLE output names (status/key/drift) collide with table columns
-- referenced in the body; resolve bare names to the column, not the out-parameter.
#variable_conflict use_column
begin
  return query
  with registry(key, domain, title, severity, implemented, unit) as (
    values
      -- money — GL / outbox / double-post
      ('tb_global_balanced',                 'money',    'Global trial balance: Σdebit = Σcredit',                 'crit', true,  'U1'),
      ('entry_balanced_each',                'money',    'Every posted entry balances (Σd = Σc > 0)',             'crit', true,  'U1'),
      ('control_tie_single_feeder',          'money',    'Single-feeder GL controls tie to subledger',            'high', true,  'U1'),
      ('posting_backlog_zero',               'money',    'GL posting outbox has no backlog',                      'high', true,  'U1'),
      ('inventory_1500',                      'money',    'Inventory 1500 (net capitalized PO charges) ties to on-hand',  'high', true,  'U7'),
      ('source_doc_posted_complete',         'money',    'Every postable source doc has a posted entry',          'high', false, 'U2'),
      ('control_tie_multi_feeder',           'money',    'Multi-feeder GL controls tie (2110 / 2100 / 1400)',     'high', false, 'U2'),
      ('outbox_pending_lag',                 'money',    'No GL outbox row pending > 5 min',                      'crit', false, 'U2'),
      ('outbox_failed_zero',                 'money',    'No failed GL outbox row',                               'high', false, 'U2'),
      ('drain_cron_alive',                   'money',    'GL drain cron scheduled + last run succeeded',          'crit', false, 'U2'),
      ('drained_equals_posted',              'money',    'Drained outbox rows map to a live posted entry',        'high', false, 'U2'),
      ('no_double_post',                     'money',    '≤ 1 un-reversed posted entry per source doc',           'crit', false, 'U2'),
      ('superseded_posts_nothing',           'money',    'Superseded payment rows post nothing',                  'crit', false, 'U2'),
      ('poster_guard_present',               'money',    'Every GL poster carries the self-reverse guard',        'high', false, 'U2'),
      ('peak_queue_not_growing',             'money',    'PEAK sync dead-queue pending count',                    'med',  false, 'U2'),
      -- access / RLS
      ('definer_no_anon_exec',               'access',   'No definer function grants anon EXECUTE',               'crit', false, 'U3'),
      ('no_null_unsafe_gate',                'access',   'No definer gate falls open on a NULL role',             'crit', false, 'U3'),
      ('rls_enabled_all_tables',             'access',   'Every base table has RLS enabled',                      'crit', false, 'U3'),
      ('rls_table_has_policy',               'access',   'Every RLS-enabled table has a policy',                  'high', false, 'U3'),
      ('gating_helper_not_null',             'access',   'Gating helpers non-null for a roleless caller',         'crit', false, 'U3'),
      ('audit_log_scoped',                   'access',   'audit_log SELECT scoped; no anon/authenticated INSERT', 'high', false, 'U3'),
      ('anon_no_table_dml',                  'access',   'No unexpected anon table DML grant',                    'high', false, 'U3'),
      -- identity / roster
      ('worker_user_orphan',                 'identity', 'No worker bound to a missing user',                     'high', false, 'U4'),
      ('authuser_publicuser_reconcile',      'identity', 'No auth user without a public.users row',               'med',  false, 'U4'),
      ('crew_member_integrity',              'identity', 'Crew members: one-active, live crew + worker',          'high', false, 'U4'),
      ('active_membership_deactivated_crew', 'identity', 'No active membership in a deactivated crew',            'med',  false, 'U4'),
      ('crew_lead_active',                   'identity', 'No active crew with an inactive lead',                  'med',  false, 'U4'),
      ('worker_project_matches_move',        'identity', 'worker.project_id equals the latest move',              'med',  false, 'U4'),
      ('cost_confirmed_complete',            'identity', 'Cost-confirmed workers are fully specified',            'med',  false, 'U4'),
      ('roster_dedup',                       'identity', 'No duplicate tax_id / pending national_id',             'high', false, 'U4'),
      ('client_grant_expired_not_revoked',   'identity', 'Expired-but-not-revoked client grants (hygiene)',       'low',  false, 'U4'),
      -- schema / drift (external — reported by CI, U7)
      ('known_red_baseline',                 'schema',   'pgTAP known-red count == codified manifest',            'med',  false, 'U6'),
      ('schema_drift_clean',                 'schema',   'db push --dry-run == up to date',                       'high', false, 'U7'),
      ('db_types_fresh',                     'schema',   'db:types == committed database.types.ts',               'med',  false, 'U7'),
      ('migration_order_monotonic',          'schema',   'Migration timestamps strictly increasing',              'low',  false, 'U7')
  ),
  -- Reconciliation math inlined (mirrors gl_reconciliation, 20260748000000) so this
  -- compute is SELF-CONTAINED — it never calls the role-gated gl_reconciliation() RPC,
  -- which would 42501 for the cron (null-role) and probe contexts.
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
      (select coalesce(sum(total_value), 0) from public.stock_on_hand) as inventory_onhand,
      (select coalesce(sum(l.debit - l.credit), 0)
         from public.journal_lines l
         join public.journal_entries e on e.id = l.entry_id
         join public.gl_accounts a on a.id = l.account_id
        where a.code = '1500' and e.source_table = 'purchase_order_charges') as po_charge_1500,
      -- Pending gate scoped to the posters that touch account 1500 (else ANY
      -- unrelated in-flight posting would mask a real 1500 gap for the scan cycle).
      (select count(*)::numeric from public.gl_posting_outbox
         where status = 'pending'
           and source_table in ('stock_receipts', 'stock_issues', 'stock_returns',
                                 'stock_counts', 'stock_reversals',
                                 'stock_receipt_corrections', 'purchase_order_charges')) as inv_pending,
      (select count(*)::numeric from public.gl_posting_outbox
         where status in ('pending', 'failed')) as backlog
  ),
  ctrl as (
    select a.code,
           coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as dr_minus_cr,
           coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) as cr_minus_dr
      from public.gl_accounts a
      left join public.journal_lines l on l.account_id = a.id
     where a.code in ('1210', '2210', '1310', '2200', '1500')
     group by a.code
  ),
  computed(key, status, drift, offending_count, sample) as (
    -- tb_global_balanced
    select 'tb_global_balanced',
           case when s.tb_debit = s.tb_credit then 'green' else 'red' end,
           s.tb_debit - s.tb_credit, null::integer, null::jsonb
      from sub s
    union all
    -- posting_backlog_zero
    select 'posting_backlog_zero',
           case when s.backlog = 0 then 'green' else 'red' end,
           s.backlog, s.backlog::integer, null::jsonb
      from sub s
    union all
    -- control_tie_single_feeder  (1210 / 2210 / 1310 / 2200 tie to their subledgers)
    select 'control_tie_single_feeder',
           case when coalesce((select dr_minus_cr from ctrl where code = '1210'), 0) = s.retention_open
                 and coalesce((select cr_minus_dr from ctrl where code = '2210'), 0) = s.wht_deducted
                 and coalesce((select dr_minus_cr from ctrl where code = '1310'), 0) = s.wht_suffered
                 and coalesce((select cr_minus_dr from ctrl where code = '2200'), 0) = s.output_vat
                then 'green' else 'red' end,
           ( abs(coalesce((select dr_minus_cr from ctrl where code = '1210'), 0) - s.retention_open)
           + abs(coalesce((select cr_minus_dr from ctrl where code = '2210'), 0) - s.wht_deducted)
           + abs(coalesce((select dr_minus_cr from ctrl where code = '1310'), 0) - s.wht_suffered)
           + abs(coalesce((select cr_minus_dr from ctrl where code = '2200'), 0) - s.output_vat) ),
           null::integer, null::jsonb
      from sub s
    union all
    -- entry_balanced_each  (NEW — per-entry defence in depth)
    select 'entry_balanced_each',
           case when agg.cnt = 0 then 'green' else 'red' end,
           agg.cnt::numeric, agg.cnt::integer, agg.sample
      from (
        select count(*) as cnt,
               coalesce(jsonb_agg(entry_id) filter (where rn <= 20), '[]'::jsonb) as sample
          from (
            select bad.entry_id, row_number() over (order by bad.entry_id) as rn
              from (
                select l.entry_id
                  from public.journal_lines l
                  join public.journal_entries en on en.id = l.entry_id
                 where en.status = 'posted'
                 group by l.entry_id
                having sum(l.debit) <> sum(l.credit) or sum(l.debit) = 0
              ) bad
          ) ranked
      ) agg
    union all
    -- inventory_1500 — GL 1500 nets the capitalized PO charges (freight/discount
    -- post to 1500 but never the moving-avg store pool). Pending-gated: skip while
    -- 1500-affecting postings are in flight (a FAILED row is NOT skipped —
    -- posting_backlog_zero / outbox_failed_zero own that, and a failed 1500 post is a
    -- real gap to surface). ASSUMPTION: purchase_order_charges is the ONLY 1500 poster
    -- that does not flow into the on-hand pool; a new 1500-affecting poster (or a
    -- po_charge that ever lands in the pool) must be added to this term or it is
    -- silently absorbed. Verified sole exemption live 2026-07-17 (residual 0.00).
    select 'inventory_1500',
           case when s.inv_pending > 0 then 'green'
                when coalesce((select dr_minus_cr from ctrl where code = '1500'), 0)
                       = s.inventory_onhand + s.po_charge_1500 then 'green'
                else 'red' end,
           -- Drift is meaningless while the gate greens the row (postings draining) → 0.
           case when s.inv_pending > 0 then 0
                else coalesce((select dr_minus_cr from ctrl where code = '1500'), 0)
                       - (s.inventory_onhand + s.po_charge_1500) end,
           null::integer, null::jsonb
      from sub s
  )
  select reg.key, reg.domain, reg.title, reg.severity,
         case when reg.implemented then coalesce(c.status, 'green') else 'na' end,
         c.drift,
         c.offending_count,
         c.sample,
         reg.implemented,
         reg.unit
    from registry reg
    left join computed c on c.key = reg.key
   order by reg.domain, reg.key;
end;
$function$
;
