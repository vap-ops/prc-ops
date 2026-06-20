begin;
select plan(12);

-- ============================================================================
-- Spec 161 U3 / ADR 0060 §2 — wp_labor_sell(p_wp): the novel core of the WP
--   profit engine. DC labor on the WP valued at the per-LEVEL SELL rate (the
--   markup the company keeps) — the same current logs freeze_wp_labor_cost sums
--   at COST. internal_sell unless the WP is external → external_sell. Current
--   rows only (anti-join + tombstone filter, ADR 0009); own labor excluded
--   (payroll, not transfer-priced); an ungraded DC contributes 0 (never inflate).
--   Gate: super_admin + project_director (no project_manager → 90/91 untouched).
--   Pure read — no audit, no enum. Reads zero-grant money tables (definer).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110763', 'super@sell.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550763', 'dir@sell.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330763', 'pm@sell.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220763', 'sa@sell.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880763', 'vis@sell.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110763';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550763';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330763';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220763';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('ca0a0763-0763-0763-0763-ca0aca0a0763', 'PRC-763-P1', 'โครงการ U3');

-- Three WPs: A internal (no wp_economics row → internal default), B external
-- (same crew, must sum higher), C the exclusion edge cases.
insert into public.work_packages (id, project_id, code, name, status) values
  ('ea0a0763-0763-0763-0763-ea0aea0a0763', 'ca0a0763-0763-0763-0763-ca0aca0a0763',
   'WP-A', 'ภายใน', 'in_progress'),
  ('eb0b0763-0763-0763-0763-eb0beb0b0763', 'ca0a0763-0763-0763-0763-ca0aca0a0763',
   'WP-B', 'ภายนอก', 'in_progress'),
  ('ec0c0763-0763-0763-0763-ec0cec0c0763', 'ca0a0763-0763-0763-0763-ca0aca0a0763',
   'WP-C', 'ขอบเขต', 'in_progress');

-- WP-B is external; WP-A / WP-C have no row (internal by default, U2 posture).
insert into public.wp_economics (work_package_id, is_external) values
  ('eb0b0763-0763-0763-0763-eb0beb0b0763', true);

-- Graded DCs (senior/mid/junior/apprentice), one UNGRADED DC, and an own tech
-- that carries a level (must still be excluded — own is not transfer-priced).
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, level, created_by) values
  ('d1110763-0763-0763-0763-d11d11d10763', 'DC อาวุโส', 'dc',  null, null, 0, true, 'senior',
   '11111111-1111-1111-1111-111111110763'),
  ('d2220763-0763-0763-0763-d22d22d20763', 'DC กลาง',   'dc',  null, null, 0, true, 'mid',
   '11111111-1111-1111-1111-111111110763'),
  ('d3330763-0763-0763-0763-d33d33d30763', 'DC จูเนียร์', 'dc', null, null, 0, true, 'junior',
   '11111111-1111-1111-1111-111111110763'),
  ('d4440763-0763-0763-0763-d44d44d40763', 'DC ฝึกหัด',  'dc',  null, null, 0, true, 'apprentice',
   '11111111-1111-1111-1111-111111110763'),
  ('d5550763-0763-0763-0763-d55d55d50763', 'DC ไม่จัดเกรด', 'dc', null, null, 0, true, null,
   '11111111-1111-1111-1111-111111110763'),
  ('00aa0763-0763-0763-0763-00aa00aa0763', 'ช่างบริษัท', 'own', null, null, 0, true, 'senior',
   '11111111-1111-1111-1111-111111110763');

-- WP-A (internal): senior full (800) + mid half (350) = 1150.00.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa010763-0763-0763-0763-fa01fa010763', 'ea0a0763-0763-0763-0763-ea0aea0a0763',
   'd1110763-0763-0763-0763-d11d11d10763', date '2026-06-10', 'full', 0, 'DC อาวุโส', 'dc', null,
   '11111111-1111-1111-1111-111111110763'),
  ('fa020763-0763-0763-0763-fa02fa020763', 'ea0a0763-0763-0763-0763-ea0aea0a0763',
   'd2220763-0763-0763-0763-d22d22d20763', date '2026-06-11', 'half', 0, 'DC กลาง', 'dc', null,
   '11111111-1111-1111-1111-111111110763');

-- WP-B (external): the SAME crew/days → senior full (950) + mid half (425) = 1375.00.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fb010763-0763-0763-0763-fb01fb010763', 'eb0b0763-0763-0763-0763-eb0beb0b0763',
   'd1110763-0763-0763-0763-d11d11d10763', date '2026-06-10', 'full', 0, 'DC อาวุโส', 'dc', null,
   '11111111-1111-1111-1111-111111110763'),
  ('fb020763-0763-0763-0763-fb02fb020763', 'eb0b0763-0763-0763-0763-eb0beb0b0763',
   'd2220763-0763-0763-0763-d22d22d20763', date '2026-06-11', 'half', 0, 'DC กลาง', 'dc', null,
   '11111111-1111-1111-1111-111111110763');

-- WP-C (internal): the exclusion edge cases. Only the junior's CURRENT half
-- correction counts → 580 × 0.5 = 290.00. Everything else contributes 0.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  -- ungraded DC full → no level → 0.
  ('fc010763-0763-0763-0763-fc01fc010763', 'ec0c0763-0763-0763-0763-ec0cec0c0763',
   'd5550763-0763-0763-0763-d55d55d50763', date '2026-06-12', 'full', 0, 'DC ไม่จัดเกรด', 'dc', null,
   '11111111-1111-1111-1111-111111110763'),
  -- own (senior) full → not DC → excluded.
  ('fc020763-0763-0763-0763-fc02fc020763', 'ec0c0763-0763-0763-0763-ec0cec0c0763',
   '00aa0763-0763-0763-0763-00aa00aa0763', date '2026-06-12', 'full', 0, 'ช่างบริษัท', 'own', null,
   '11111111-1111-1111-1111-111111110763'),
  -- junior full → SUPERSEDED by the half correction below (excluded).
  ('fc030763-0763-0763-0763-fc03fc030763', 'ec0c0763-0763-0763-0763-ec0cec0c0763',
   'd3330763-0763-0763-0763-d33d33d30763', date '2026-06-12', 'full', 0, 'DC จูเนียร์', 'dc', null,
   '11111111-1111-1111-1111-111111110763'),
  -- apprentice full → SUPERSEDED by the tombstone below (excluded).
  ('fc050763-0763-0763-0763-fc05fc050763', 'ec0c0763-0763-0763-0763-ec0cec0c0763',
   'd4440763-0763-0763-0763-d44d44d40763', date '2026-06-13', 'full', 0, 'DC ฝึกหัด', 'dc', null,
   '11111111-1111-1111-1111-111111110763');
-- junior CURRENT correction (full → half): counts → 580 × 0.5 = 290.00.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by,
    superseded_by, correction_reason) values
  ('fc040763-0763-0763-0763-fc04fc040763', 'ec0c0763-0763-0763-0763-ec0cec0c0763',
   'd3330763-0763-0763-0763-d33d33d30763', date '2026-06-12', 'half', 0, 'DC จูเนียร์', 'dc', null,
   '11111111-1111-1111-1111-111111110763',
   'fc030763-0763-0763-0763-fc03fc030763', 'แก้เป็นครึ่งวัน'),
  -- apprentice TOMBSTONE (null fraction): removed → excluded.
  ('fc060763-0763-0763-0763-fc06fc060763', 'ec0c0763-0763-0763-0763-ec0cec0c0763',
   'd4440763-0763-0763-0763-d44d44d40763', date '2026-06-13', null, 0, 'DC ฝึกหัด', 'dc', null,
   '11111111-1111-1111-1111-111111110763',
   'fc050763-0763-0763-0763-fc05fc050763', 'ลบรายการ');

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'wp_labor_sell', ARRAY['uuid'],
  'wp_labor_sell(uuid) exists');
select is((select prosecdef from pg_proc
            where oid = 'public.wp_labor_sell(uuid)'::regprocedure),
  true, 'wp_labor_sell is SECURITY DEFINER');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. Gate — super + director succeed; pm / site_admin / visitor → 42501.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110763"}';
select lives_ok(
  $$ select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763') $$,
  'super_admin may read the WP sell total');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550763"}';
select lives_ok(
  $$ select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763') $$,
  'project_director may read the WP sell total');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330763"}';
select throws_ok(
  $$ select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763') $$,
  '42501', null, 'project_manager cannot read the WP sell total');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220763"}';
select throws_ok(
  $$ select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763') $$,
  '42501', null, 'site_admin cannot read the WP sell total');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880763"}';
select throws_ok(
  $$ select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763') $$,
  '42501', null, 'visitor cannot read the WP sell total');

-- ============================================================================
-- C. Money math (as super).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110763"}';
select is(
  (select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763')),
  1150.00::numeric,
  'internal WP: senior full (800) + mid half (350) at internal_sell = 1150');
select is(
  (select public.wp_labor_sell('eb0b0763-0763-0763-0763-eb0beb0b0763')),
  1375.00::numeric,
  'external WP: the same crew at external_sell = 1375 (senior 950 + mid half 425)');
select ok(
  (select public.wp_labor_sell('eb0b0763-0763-0763-0763-eb0beb0b0763'))
    > (select public.wp_labor_sell('ea0a0763-0763-0763-0763-ea0aea0a0763')),
  'the same crew sums higher on an external WP');
select is(
  (select public.wp_labor_sell('ec0c0763-0763-0763-0763-ec0cec0c0763')),
  290.00::numeric,
  'edge WP: only the junior current half (290) counts — ungraded/own/superseded/tombstone all 0');

-- ============================================================================
-- D. Unknown WP → P0001 (a typo errors, never a misleading 0).
-- ============================================================================
select throws_ok(
  $$ select public.wp_labor_sell('dddddddd-0763-0763-0763-dddddddd0763') $$,
  'P0001', null, 'an unknown work package is rejected');

reset role;

select * from finish();
rollback;
