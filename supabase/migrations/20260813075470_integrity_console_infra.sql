-- Spec 283 U1 / System Integrity Console (ตรวจระบบ) — infra + GL money checks.
--
-- Turns the operator's per-session hand-verification ritual into a keyed check
-- REGISTRY that runs on a schedule and persists to history. The registry lists EVERY
-- check across all domains from day one (the board doubles as the roadmap, spec §D2);
-- U1 implements the GL money checks (the reconciliation math is inlined here, kept
-- self-contained rather than calling the role-gated gl_reconciliation() RPC, + 2 NEW);
-- everything else is a metadata-only 'na' (greyed) row until its unit ships.
--
-- Layering (each gate is deliberate):
--   _integrity_check_results()   internal compute; REVOKED from anon+authenticated
--                                (only the definer wrappers below / postgres invoke it).
--   run_integrity_checks()       super_admin-gated reader (the console board + "run now"
--                                display). granted authenticated.
--   run_and_record_integrity()   super_admin-gated; records one 'manual' run, returns run_id.
--   integrity_scan()             the CRON entry — NO jwt gate (pg_cron runs it as owner,
--                                current_user_role() is null there); REVOKED from
--                                anon+authenticated so no PostgREST caller can reach it.
--
-- Read-only: nothing here mutates domain data (spec D5). Alerting on green->red is U6.

-- ----------------------------------------------------------------------------
-- History table. super_admin-only RLS SELECT; writes only via the definer functions.
-- ----------------------------------------------------------------------------
create table public.integrity_check_runs (
  id              bigint generated always as identity primary key,
  run_id          uuid        not null,
  ran_at          timestamptz not null default now(),
  trigger         text        not null check (trigger in ('cron', 'manual')),
  key             text        not null,
  domain          text        not null,
  severity        text        not null,
  status          text        not null,
  drift           numeric,
  offending_count integer,
  sample          jsonb
);
create index integrity_check_runs_run_idx    on public.integrity_check_runs (run_id);
create index integrity_check_runs_ran_at_idx on public.integrity_check_runs (ran_at desc);

alter table public.integrity_check_runs enable row level security;

revoke all on public.integrity_check_runs from anon;
grant select on public.integrity_check_runs to authenticated;

create policy integrity_check_runs_super_read on public.integrity_check_runs
  for select
  using ((select public.current_user_role()) = 'super_admin');

comment on table public.integrity_check_runs is
  'Spec 283 — persisted history of System Integrity Console scans. One row per check per run. super_admin-only read; written only by the definer runner functions (run_and_record_integrity / integrity_scan).';

-- ----------------------------------------------------------------------------
-- Internal compute. Returns the full registry with current status for the
-- implemented checks and 'na' for the not-yet-built ones. No gate; locked down by
-- grants (only the definer wrappers / postgres call it).
-- ----------------------------------------------------------------------------
create function public._integrity_check_results()
returns table (
  key             text,
  domain          text,
  title           text,
  severity        text,
  status          text,
  drift           numeric,
  offending_count integer,
  sample          jsonb,
  implemented     boolean,
  unit            text
)
language plpgsql
security definer
set search_path = public
as $$
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
      (select count(*)::numeric from public.gl_posting_outbox
         where status in ('pending', 'failed')) as backlog
  ),
  ctrl as (
    select a.code,
           coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as dr_minus_cr,
           coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) as cr_minus_dr
      from public.gl_accounts a
      left join public.journal_lines l on l.account_id = a.id
     where a.code in ('1210', '2210', '1310', '2200')
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
$$;
revoke all on function public._integrity_check_results() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- run_integrity_checks() — the super_admin reader (console board + "run now" display).
-- ----------------------------------------------------------------------------
create function public.run_integrity_checks()
returns table (
  key             text,
  domain          text,
  title           text,
  severity        text,
  status          text,
  drift           numeric,
  offending_count integer,
  sample          jsonb,
  implemented     boolean,
  unit            text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'run_integrity_checks: super_admin only' using errcode = '42501';
  end if;
  return query select * from public._integrity_check_results();
end;
$$;
revoke all on function public.run_integrity_checks() from public, anon;
grant execute on function public.run_integrity_checks() to authenticated;

-- ----------------------------------------------------------------------------
-- run_and_record_integrity() — super_admin "run now": records one 'manual' run.
-- ----------------------------------------------------------------------------
create function public.run_and_record_integrity()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_run  uuid := gen_random_uuid();
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'run_and_record_integrity: super_admin only' using errcode = '42501';
  end if;
  insert into public.integrity_check_runs (run_id, trigger, key, domain, severity, status, drift, offending_count, sample)
  select v_run, 'manual', key, domain, severity, status, drift, offending_count, sample
    from public._integrity_check_results();
  return v_run;
end;
$$;
revoke all on function public.run_and_record_integrity() from public, anon;
grant execute on function public.run_and_record_integrity() to authenticated;

-- ----------------------------------------------------------------------------
-- integrity_scan() — the CRON entry. No jwt gate (pg_cron runs it as owner);
-- locked from every PostgREST role so it can only be invoked by the scheduler.
-- ----------------------------------------------------------------------------
create function public.integrity_scan()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid := gen_random_uuid();
begin
  insert into public.integrity_check_runs (run_id, trigger, key, domain, severity, status, drift, offending_count, sample)
  select v_run, 'cron', key, domain, severity, status, drift, offending_count, sample
    from public._integrity_check_results();
  return v_run;
end;
$$;
revoke all on function public.integrity_scan() from public, anon, authenticated;
