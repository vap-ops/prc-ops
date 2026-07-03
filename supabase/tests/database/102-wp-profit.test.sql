begin;
select plan(18);

-- ============================================================================
-- Spec 161 U3b / ADR 0060 §2 + ADR 0057 — wp_profit(p_wp): the WP profit read.
--   profit = budget − labor_sell − materials − equipment, with MATERIALS DERIVED
--   FROM THE GL (journal_lines, account 1400/WIP, purchase-sourced, reversal-safe
--   via reversal_of) — NOT a re-sum of purchase_requests. Labor also debits 1400
--   but is excluded (source wp_labor_costs). Equipment is now WP-dimensioned
--   (spec 146 U3 wp_equipment_sell, equipment_costed=true; 0 with no usage logs).
--   budget NULL →
--   profit NULL. Gate super_admin + project_director (no PM ref → 90/91 untouched).
--   Journal rows seeded directly (period + entries + lines) to isolate from the
--   poster machinery.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110764', 'super@prof.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550764', 'dir@prof.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330764', 'pm@prof.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220764', 'sa@prof.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880764', 'vis@prof.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110764';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550764';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330764';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220764';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('ca0a0764-0764-0764-0764-ca0aca0a0764', 'PRC-764-P1', 'โครงการ U3b');

-- WP-A fully costed; WP-B reversal-safe materials; WP-C budget-null.
insert into public.work_packages (id, project_id, code, name, status) values
  ('ea0a0764-0764-0764-0764-ea0aea0a0764', 'ca0a0764-0764-0764-0764-ca0aca0a0764',
   'WP-A', 'งานเต็ม', 'in_progress'),
  ('eb0b0764-0764-0764-0764-eb0beb0b0764', 'ca0a0764-0764-0764-0764-ca0aca0a0764',
   'WP-B', 'แก้กลับ', 'in_progress'),
  ('ec0c0764-0764-0764-0764-ec0cec0c0764', 'ca0a0764-0764-0764-0764-ca0aca0a0764',
   'WP-C', 'ไม่มีงบ', 'in_progress');

-- Budgets: WP-A 5000, WP-B 4000; WP-C has NO wp_economics row (budget null).
insert into public.wp_economics (work_package_id, budget) values
  ('ea0a0764-0764-0764-0764-ea0aea0a0764', 5000),
  ('eb0b0764-0764-0764-0764-eb0beb0b0764', 4000);

-- WP-A DC labor: one senior full day on an internal WP → wp_labor_sell = 800.
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, level, created_by) values
  ('d1110764-0764-0764-0764-d11d11d10764', 'DC อาวุโส', 'dc', null, null, 0, true, 'senior',
   '11111111-1111-1111-1111-111111110764');
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa010764-0764-0764-0764-fa01fa010764', 'ea0a0764-0764-0764-0764-ea0aea0a0764',
   'd1110764-0764-0764-0764-d11d11d10764', date '2026-06-10', 'full', 0, 'DC อาวุโส', 'dc', null,
   '11111111-1111-1111-1111-111111110764');

-- A unique accounting period to hang the seeded journal entries on (far-future
-- month → no collision with any real period; wp_profit ignores entry_date).
insert into public.accounting_periods (id, period_month) values
  ('aaaa0764-0764-0764-0764-aaaaaaaa0764', date '2099-12-01');

-- --- WP-A journal: a purchase (materials, counted) + a labor accrual (excluded) ---
-- Purchase: Dr WIP 1400 net 1000 (WP-A) / Cr AP 2100 1000.
insert into public.journal_entries (id, entry_date, period_id, source_table, source_id,
    source_event, status, posted_by) values
  ('1a010764-0764-0764-0764-1a011a010764', date '2099-12-15',
   'aaaa0764-0764-0764-0764-aaaaaaaa0764', 'purchase_requests', null, 'purchase', 'posted',
   '11111111-1111-1111-1111-111111110764');
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit,
    project_id, work_package_id) values
  ('1a010764-0764-0764-0764-1a011a010764', 1,
   (select id from public.gl_accounts where code = '1400'), 1000, 0,
   'ca0a0764-0764-0764-0764-ca0aca0a0764', 'ea0a0764-0764-0764-0764-ea0aea0a0764'),
  ('1a010764-0764-0764-0764-1a011a010764', 2,
   (select id from public.gl_accounts where code = '2100'), 0, 1000, null, null);
-- Labor accrual on the SAME WP also debits 1400 — must be EXCLUDED from materials.
insert into public.journal_entries (id, entry_date, period_id, source_table, source_id,
    source_event, status, posted_by) values
  ('1a020764-0764-0764-0764-1a021a020764', date '2099-12-15',
   'aaaa0764-0764-0764-0764-aaaaaaaa0764', 'wp_labor_costs', null, 'labor_freeze', 'posted',
   '11111111-1111-1111-1111-111111110764');
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit,
    project_id, work_package_id) values
  ('1a020764-0764-0764-0764-1a021a020764', 1,
   (select id from public.gl_accounts where code = '1400'), 500, 0,
   'ca0a0764-0764-0764-0764-ca0aca0a0764', 'ea0a0764-0764-0764-0764-ea0aea0a0764'),
  ('1a020764-0764-0764-0764-1a021a020764', 2,
   (select id from public.gl_accounts where code = '2110'), 0, 500, null, null);

-- --- WP-B journal: purchase 2000 → reversal → re-post 1500 (net materials 1500) ---
-- E1 original purchase: Dr 1400 2000 / Cr 2100 2000.
insert into public.journal_entries (id, entry_date, period_id, source_table, source_id,
    source_event, status, posted_by) values
  ('1b010764-0764-0764-0764-1b011b010764', date '2099-12-15',
   'aaaa0764-0764-0764-0764-aaaaaaaa0764', 'purchase_requests', null, 'purchase', 'posted',
   '11111111-1111-1111-1111-111111110764');
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit,
    project_id, work_package_id) values
  ('1b010764-0764-0764-0764-1b011b010764', 1,
   (select id from public.gl_accounts where code = '1400'), 2000, 0,
   'ca0a0764-0764-0764-0764-ca0aca0a0764', 'eb0b0764-0764-0764-0764-eb0beb0b0764'),
  ('1b010764-0764-0764-0764-1b011b010764', 2,
   (select id from public.gl_accounts where code = '2100'), 0, 2000, null, null);
-- E2 reversal of E1: source 'journal_reversal', reversal_of=E1, debit/credit swapped,
-- work_package_id copied (the real reverse_journal_internal shape).
insert into public.journal_entries (id, entry_date, period_id, source_table, source_id,
    source_event, status, reversal_of, posted_by) values
  ('1b020764-0764-0764-0764-1b021b020764', date '2099-12-16',
   'aaaa0764-0764-0764-0764-aaaaaaaa0764', 'journal_reversal',
   '1b010764-0764-0764-0764-1b011b010764', 'reversal', 'posted',
   '1b010764-0764-0764-0764-1b011b010764', '11111111-1111-1111-1111-111111110764');
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit,
    project_id, work_package_id) values
  ('1b020764-0764-0764-0764-1b021b020764', 1,
   (select id from public.gl_accounts where code = '1400'), 0, 2000,
   'ca0a0764-0764-0764-0764-ca0aca0a0764', 'eb0b0764-0764-0764-0764-eb0beb0b0764'),
  ('1b020764-0764-0764-0764-1b021b020764', 2,
   (select id from public.gl_accounts where code = '2100'), 2000, 0, null, null);
-- E3 re-posted corrected purchase: Dr 1400 1500 / Cr 2100 1500.
insert into public.journal_entries (id, entry_date, period_id, source_table, source_id,
    source_event, status, posted_by) values
  ('1b030764-0764-0764-0764-1b031b030764', date '2099-12-16',
   'aaaa0764-0764-0764-0764-aaaaaaaa0764', 'purchase_requests', null, 'purchase', 'posted',
   '11111111-1111-1111-1111-111111110764');
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit,
    project_id, work_package_id) values
  ('1b030764-0764-0764-0764-1b031b030764', 1,
   (select id from public.gl_accounts where code = '1400'), 1500, 0,
   'ca0a0764-0764-0764-0764-ca0aca0a0764', 'eb0b0764-0764-0764-0764-eb0beb0b0764'),
  ('1b030764-0764-0764-0764-1b031b030764', 2,
   (select id from public.gl_accounts where code = '2100'), 0, 1500, null, null);

-- --- WP-C journal: a 300 purchase, but NO budget (profit must be NULL) ---
insert into public.journal_entries (id, entry_date, period_id, source_table, source_id,
    source_event, status, posted_by) values
  ('1c010764-0764-0764-0764-1c011c010764', date '2099-12-15',
   'aaaa0764-0764-0764-0764-aaaaaaaa0764', 'purchase_requests', null, 'purchase', 'posted',
   '11111111-1111-1111-1111-111111110764');
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit,
    project_id, work_package_id) values
  ('1c010764-0764-0764-0764-1c011c010764', 1,
   (select id from public.gl_accounts where code = '1400'), 300, 0,
   'ca0a0764-0764-0764-0764-ca0aca0a0764', 'ec0c0764-0764-0764-0764-ec0cec0c0764'),
  ('1c010764-0764-0764-0764-1c011c010764', 2,
   (select id from public.gl_accounts where code = '2100'), 0, 300, null, null);

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'wp_profit', ARRAY['uuid'], 'wp_profit(uuid) exists');
select is((select prosecdef from pg_proc
            where oid = 'public.wp_profit(uuid)'::regprocedure),
  true, 'wp_profit is SECURITY DEFINER');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. Gate — super + director read; pm / site_admin / visitor → 42501.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110764"}';
select lives_ok(
  $$ select * from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764') $$,
  'super_admin may read WP profit');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550764"}';
select lives_ok(
  $$ select * from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764') $$,
  'project_director may read WP profit');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330764"}';
-- Spec 252: the gate widened super/PD-only → is_manager ∨ accounting, so the PM
-- reads WP profit now (the finance drill is a PM ∪ accounting surface).
select lives_ok(
  $$ select * from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764') $$,
  'project_manager may read WP profit (spec 252)');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220764"}';
select throws_ok(
  $$ select * from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764') $$,
  '42501', null, 'site_admin cannot read WP profit');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880764"}';
select throws_ok(
  $$ select * from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764') $$,
  '42501', null, 'visitor cannot read WP profit');

-- ============================================================================
-- C. WP-A — every component (materials excludes the labor 1400 entry).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110764"}';
select is((select budget from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764')),
  5000.00::numeric, 'WP-A budget = 5000');
select is((select labor_sell from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764')),
  800.00::numeric, 'WP-A labor_sell = senior full at internal = 800');
select is((select materials_cost from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764')),
  1000.00::numeric, 'WP-A materials_cost = purchase 1400 net (labor 1400 excluded)');
select is((select equipment_cost from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764')),
  0::numeric, 'WP-A equipment_cost = 0 (the flagged gap)');
select is((select equipment_costed from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764')),
  true, 'WP-A equipment_costed = true (spec 146 U3 — no usage logs here, so cost = 0)');
select is((select profit from public.wp_profit('ea0a0764-0764-0764-0764-ea0aea0a0764')),
  3200.00::numeric, 'WP-A profit = 5000 − 800 − 1000 − 0 = 3200');

-- ============================================================================
-- D. WP-B — materials nets the auto-correct reversal (2000 → reversed → 1500).
-- ============================================================================
select is((select materials_cost from public.wp_profit('eb0b0764-0764-0764-0764-eb0beb0b0764')),
  1500.00::numeric, 'WP-B materials_cost = 2000 − 2000 (reversal) + 1500 = 1500');
select is((select profit from public.wp_profit('eb0b0764-0764-0764-0764-eb0beb0b0764')),
  2500.00::numeric, 'WP-B profit = 4000 − 0 − 1500 = 2500');

-- ============================================================================
-- E. WP-C — no budget → profit NULL (components still returned).
-- ============================================================================
select is((select budget from public.wp_profit('ec0c0764-0764-0764-0764-ec0cec0c0764')),
  null, 'WP-C budget is NULL (no wp_economics row)');
select is((select profit from public.wp_profit('ec0c0764-0764-0764-0764-ec0cec0c0764')),
  null, 'WP-C profit is NULL when budget is unset');

-- ============================================================================
-- F. Unknown WP → P0001.
-- ============================================================================
select throws_ok(
  $$ select * from public.wp_profit('dddddddd-0764-0764-0764-dddddddd0764') $$,
  'P0001', null, 'an unknown work package is rejected');

reset role;

select * from finish();
rollback;
