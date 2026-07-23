-- Spec 347 U1 — store-first purchase PRICE correction: ledger + complete GL plumbing.
--
-- A GL-correct way to fix a store-first purchase whose unit PRICE (or VAT rate) was
-- entered wrong. The frozen source rows (purchase_requests.amount, stock_receipts)
-- stay frozen; the correction lives in an append-only ledger and posts a SIGNED contra
-- moving GL 1500 + the inventory pool by delta_net and 1300/2100 by the VAT/AP residual.
--
-- This unit ships ALL the GL plumbing BEFORE the RPC exists (spec ordering constraint):
-- there must never be a live window where the pool can move without its contra enqueued.
-- U1 is INERT — nothing inserts into the ledger until U2's correct_purchase_price RPC.
--
-- Sibling of spec 324 correct_stock_receipt (the QUANTITY correction): same append-only
-- + fresh-pool + VAT-residual-contra family. Wiring mirrors stock_receipt_corrections.
--
-- Posture note (gate-check catch): the spec text says "sealed like stock_receipt_corrections",
-- but the live 324 table is authenticated-READABLE (2 SELECT policies). The true zero-grant
-- precedent is the spec-345 review tables (money_event_reviews / money_review_flags):
-- RLS on, ZERO policies, no app-role grants — reads go through DEFINER functions only.
-- This table follows that sealed posture, per the spec's explicit design (U3/U4 read via DEFINER).

-- ---------------------------------------------------------------------------
-- 1. The append-only price-correction ledger.
-- ---------------------------------------------------------------------------
create table public.stock_receipt_price_corrections (
  id                 uuid primary key default gen_random_uuid(),
  receipt_id         uuid not null references public.stock_receipts(id),
  corrected_amount   numeric not null,   -- the new GROSS (what the invoice really says)
  corrected_vat_rate numeric not null,
  delta_net          numeric not null,   -- signed, vs the receipt's prior EFFECTIVE net
  delta_vat          numeric not null,
  delta_gross        numeric not null,
  reason             text not null,
  flag_id            uuid references public.money_review_flags(id),
  supplier_id        uuid references public.suppliers(id),
  corrected_by       uuid references public.users(id),
  corrected_at       timestamptz not null default now(),
  constraint srpc_delta_balances  check (delta_gross = delta_net + delta_vat),
  constraint srpc_amount_positive check (corrected_amount > 0),
  constraint srpc_not_noop        check (delta_net <> 0 or delta_vat <> 0)  -- a no-op row may not exist
);

create index srpc_receipt_idx on public.stock_receipt_price_corrections (receipt_id);

-- Sealed zero-grant: RLS on, revoke every app-role grant, NO policies (DEFINER-only,
-- the spec-345 review-table posture). Postgres's default table grants to anon/authenticated
-- (Supabase default privileges) are revoked here.
alter table public.stock_receipt_price_corrections enable row level security;
revoke all on public.stock_receipt_price_corrections from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Append-only freeze (mirror stock_receipt_corrections_block_mutation).
-- ---------------------------------------------------------------------------
create or replace function public.stock_receipt_price_corrections_block_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'stock_receipt_price_corrections is append-only (a correction is itself the record): no % allowed', tg_op
    using errcode = 'P0001';
end;
$function$;

create trigger stock_receipt_price_corrections_no_update_delete
  before delete or update on public.stock_receipt_price_corrections
  for each row execute function public.stock_receipt_price_corrections_block_mutation();

create trigger stock_receipt_price_corrections_no_truncate
  before truncate on public.stock_receipt_price_corrections
  for each statement execute function public.stock_receipt_price_corrections_block_mutation();

-- ---------------------------------------------------------------------------
-- 3. GL poster — the SIGNED contra of the receipt's original รับเข้า.
--    delta_net  > 0 -> Dr 1500 ; < 0 -> Cr 1500   (inventory asset, project dim)
--    delta_vat  > 0 -> Dr 1300 ; < 0 -> Cr 1300   (input VAT, project dim)
--    delta_gross> 0 -> Cr 2100 ; < 0 -> Dr 2100   (AP, supplier dim, MIRRORED: more owed = credit)
--    Zero-delta legs are skipped. delta_gross = delta_net + delta_vat (CHECK) so the
--    entry always balances and there are always >= 2 legs. Posted into the CURRENT open
--    period. A reverse-and-repost self-guard makes an overlapping drain idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.post_stock_receipt_price_correction_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_project  uuid;
  v_net      numeric(16,2);
  v_vat      numeric(16,2);
  v_gross    numeric(16,2);
  v_supplier uuid;
  v_actor    uuid;
  v_receipt  uuid;
  v_old      uuid;
  v_lines    jsonb;
begin
  select delta_net, delta_vat, delta_gross, supplier_id, corrected_by, receipt_id
    into v_net, v_vat, v_gross, v_supplier, v_actor, v_receipt
    from public.stock_receipt_price_corrections where id = p_source_id;
  if not found then
    raise exception 'post_stock_receipt_price_correction_to_gl: correction not found' using errcode = 'P0001';
  end if;
  select project_id into v_project from public.stock_receipts where id = v_receipt;

  -- Reverse-and-repost: reverse the current (non-reversed) entry for THIS correction so
  -- an overlapping drain self-heals instead of double-posting. The correction row is
  -- immutable, so the re-post reproduces the identical contra.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_receipt_price_corrections'
     and e.source_id    = p_source_id
     and e.source_event = 'purchase_price_correction'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: price correction re-posted');
  end if;

  -- Signed legs, only the nonzero ones.
  v_lines := '[]'::jsonb;
  if coalesce(v_net, 0) <> 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1500',
      case when v_net  > 0 then 'debit' else 'credit' end, abs(v_net),   'project_id',  v_project);
  end if;
  if coalesce(v_vat, 0) <> 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1300',
      case when v_vat  > 0 then 'debit' else 'credit' end, abs(v_vat),   'project_id',  v_project);
  end if;
  if coalesce(v_gross, 0) <> 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2100',
      case when v_gross > 0 then 'credit' else 'debit' end, abs(v_gross), 'supplier_id', v_supplier);
  end if;

  return public.post_journal_internal(
    current_date, 'stock_receipt_price_corrections', p_source_id, 'purchase_price_correction',
    'แก้ไขราคาซื้อผ่านสโตร์', v_lines, null, v_actor);
end;
$function$;

revoke all on function public.post_stock_receipt_price_correction_to_gl(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Enqueue + stale-review triggers (parity with the qty ledger's wiring).
--    Enqueue key = the TABLE NAME (drain dispatches on gl_posting_outbox.source_table);
--    'purchase_price_correction' is the source_event/label.
-- ---------------------------------------------------------------------------
create trigger stock_receipt_price_corrections_enqueue_gl_posting
  after insert on public.stock_receipt_price_corrections
  for each row execute function public.enqueue_gl_posting_tg('purchase_price_correction', 'id');

create trigger stock_receipt_price_corrections_money_review_stale
  after insert on public.stock_receipt_price_corrections
  for each row execute function public.money_review_mark_stale_tg('stock_receipts', 'receipt_id');

-- ---------------------------------------------------------------------------
-- 5. Drain arm — route the new source_table to the poster (else jobs mark 'skipped').
--    6. + 7. Integrity registry — add the table to the inv_pending 1500-poster list in
--    BOTH gl_reconciliation() and _integrity_check_results(), so an in-flight correction
--    does not flash the inventory_1500 tie red for a scan cycle.
--    All three below are the LIVE function bodies (pg_get_functiondef, sourced 2026-07-24)
--    with exactly one line added each — the 324 discipline.
-- ---------------------------------------------------------------------------

-- 5. drain_gl_posting (live body + the stock_receipt_price_corrections arm)
CREATE OR REPLACE FUNCTION public.drain_gl_posting(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job   public.gl_posting_outbox;
  v_entry uuid;
  v_done  integer := 0;
begin
  for v_job in
    select * from public.gl_posting_outbox
     where status = 'pending'
     order by created_at
     limit greatest(p_limit, 0)
  loop
    begin
      case v_job.source_table
        when 'purchase_requests'        then v_entry := public.post_purchase_to_gl(v_job.source_id);
        when 'wage_payments'            then v_entry := public.post_wage_payment_to_gl(v_job.source_id);
        when 'wp_labor_costs'           then v_entry := public.post_labor_freeze_to_gl(v_job.source_id);
        when 'equipment_rental_batches' then v_entry := public.post_rental_batch_to_gl(v_job.source_id);
        when 'client_billings'          then v_entry := public.post_client_billing_to_gl(v_job.source_id);
        when 'retention_receivables'    then v_entry := public.post_retention_release_to_gl(v_job.source_id);
        when 'wht_certificates'         then v_entry := public.post_wht_certificate_to_gl(v_job.source_id);
        when 'client_receipts'          then v_entry := public.post_client_receipt_to_gl(v_job.source_id);
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        when 'stock_returns'            then v_entry := public.post_stock_return_to_gl(v_job.source_id);
        when 'stock_counts'             then v_entry := public.post_stock_count_to_gl(v_job.source_id);
        when 'stock_reversals'          then v_entry := public.post_stock_reversal_to_gl(v_job.source_id);
        when 'stock_receipt_corrections' then v_entry := public.post_stock_receipt_correction_to_gl(v_job.source_id);
        when 'stock_receipt_price_corrections' then v_entry := public.post_stock_receipt_price_correction_to_gl(v_job.source_id);
        when 'subcontract_payments'     then v_entry := public.post_subcontract_payment_to_gl(v_job.source_id);
        when 'purchase_order_charges'   then v_entry := public.post_purchase_order_charge_to_gl(v_job.source_id);
        when 'rental_charges'           then v_entry := public.post_rental_charge_to_gl(v_job.source_id);
        -- Spec 275 U3: the vendor invoice settlement (thin: overtime + deposit
        -- release only) and the deposit-paid leg (synthetic source_table).
        when 'rental_settlements'       then v_entry := public.post_rental_settlement_to_gl(v_job.source_id);
        when 'rental_deposits'          then v_entry := public.post_rental_deposit_to_gl(v_job.source_id);
        else
          update public.gl_posting_outbox
             set status = 'skipped', last_error = 'unknown source_table'
           where id = v_job.id;
          continue;
      end case;

      update public.gl_posting_outbox
         set status = 'posted', journal_entry_id = v_entry, posted_at = now()
       where id = v_job.id;
      v_done := v_done + 1;
    exception when others then
      update public.gl_posting_outbox
         set status = 'failed', last_error = left(sqlerrm, 500), attempts = attempts + 1
       where id = v_job.id;
    end;
  end loop;

  return v_done;
end;
$function$
;

-- 6. gl_reconciliation (live body + inv_pending list entry)
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
                                 'stock_receipt_corrections', 'stock_receipt_price_corrections', 'purchase_order_charges')) as inv_pending,
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

-- 7. _integrity_check_results (live body + inv_pending list entry)
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
                                 'stock_receipt_corrections', 'stock_receipt_price_corrections', 'purchase_order_charges')) as inv_pending,
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
