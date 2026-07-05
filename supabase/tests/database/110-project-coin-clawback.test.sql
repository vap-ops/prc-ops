begin;
select plan(12);

-- ============================================================================
-- Spec 161 U10 / ADR 0060 design-rule 1 — per-project defect clawback. A defect
--   that reopens a project's work claws back the project's STILL-UNVESTED
--   profit_share, leaving vested coins (past the warranty tail) and coins from
--   OTHER projects untouched. Profit_share postings carry source_project_id (new
--   column; post_coins gained a project param). claw_back_project_coins is
--   super-only, project-precise, vested-safe, idempotent (nets prior clawbacks),
--   reason 'defect_rework'.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110110', 'super@claw.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330110', 'pm@claw.local',    '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110110';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330110';

insert into public.projects (id, code, name, status) values
  ('a1110110-0110-0110-0110-a1a1a1a10110', 'PRC-110-P', 'โครงการมีตำหนิ', 'completed'),
  ('a2220110-0110-0110-0110-a2a2a2a20110', 'PRC-110-Q', 'โครงการอื่น',    'completed');

insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by) values
  ('d1110110-0110-0110-0110-d1d1d1d10110', 'W1', 'daily', 'permanent', null, null, 0, true, '11111111-1111-1111-1111-111111110110'),
  ('d2220110-0110-0110-0110-d2d2d2d20110', 'W2', 'daily', 'permanent', null, null, 0, true, '11111111-1111-1111-1111-111111110110'),
  ('d3330110-0110-0110-0110-d3d3d3d30110', 'W3', 'daily', 'permanent', null, null, 0, true, '11111111-1111-1111-1111-111111110110');

-- Profit_share postings, project-tagged. RECENT ('2026-06-20') = unvested; OLD = vested.
insert into public.coin_postings (worker_id, source, amount, reason, occurred_at, created_by, source_project_id) values
  -- W1: 1000 from P (unvested) + 500 from Q (unvested, must NOT be clawed by a P defect).
  ('d1110110-0110-0110-0110-d1d1d1d10110', 'profit_share', 1000, 'P', timestamptz '2026-06-20', '11111111-1111-1111-1111-111111110110', 'a1110110-0110-0110-0110-a1a1a1a10110'),
  ('d1110110-0110-0110-0110-d1d1d1d10110', 'profit_share', 500,  'Q', timestamptz '2026-06-20', '11111111-1111-1111-1111-111111110110', 'a2220110-0110-0110-0110-a2a2a2a20110'),
  -- W2: 800 from P (unvested).
  ('d2220110-0110-0110-0110-d2d2d2d20110', 'profit_share', 800,  'P', timestamptz '2026-06-20', '11111111-1111-1111-1111-111111110110', 'a1110110-0110-0110-0110-a1a1a1a10110'),
  -- W3: 2000 from P but OLD (vested → safe from clawback).
  ('d3330110-0110-0110-0110-d3d3d3d30110', 'profit_share', 2000, 'P-old', timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110110', 'a1110110-0110-0110-0110-a1a1a1a10110');

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_column('public', 'coin_postings', 'source_project_id', 'coin_postings has source_project_id');
select is((select prosecdef from pg_proc
            where oid='public.claw_back_project_coins(uuid,text)'::regprocedure),
  true, 'claw_back_project_coins is SECURITY DEFINER');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. Gate — super only.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330110"}';
select throws_ok(
  $$ select public.claw_back_project_coins('a1110110-0110-0110-0110-a1a1a1a10110', null) $$,
  '42501', null, 'project_manager cannot claw back');

-- ============================================================================
-- C. Super claws back project P's UNVESTED profit_share only.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110110"}';
select lives_ok(
  $$ select public.claw_back_project_coins('a1110110-0110-0110-0110-a1a1a1a10110', 'defect on WP') $$,
  'super claws back project P');

reset role;
select is(public.coin_balance('d1110110-0110-0110-0110-d1d1d1d10110'),
  500::numeric, 'W1: P unvested 1000 clawed, Q 500 kept (other project untouched)');
select is(public.coin_balance('d2220110-0110-0110-0110-d2d2d2d20110'),
  0::numeric, 'W2: P unvested 800 clawed → 0');
select is(public.coin_balance('d3330110-0110-0110-0110-d3d3d3d30110'),
  2000::numeric, 'W3: P coins are VESTED (old) → untouched');
select is((select count(*)::int from public.coin_confiscations
            where reason = 'defect_rework'),
  2, 'two defect_rework confiscations recorded (W1, W2)');
select is((select count(*)::int from public.coin_postings
            where source = 'confiscation'
              and source_project_id = 'a1110110-0110-0110-0110-a1a1a1a10110'),
  2, 'two confiscation postings tagged to project P');

-- ============================================================================
-- D. Idempotent (nets prior clawbacks) + unknown project.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110110"}';
select lives_ok(
  $$ select public.claw_back_project_coins('a1110110-0110-0110-0110-a1a1a1a10110', null) $$,
  're-clawback runs (claws nothing — already clawed)');
reset role;
select is(public.coin_balance('d1110110-0110-0110-0110-d1d1d1d10110'),
  500::numeric, 'W1 balance unchanged after a second clawback (idempotent)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110110"}';
select throws_ok(
  $$ select public.claw_back_project_coins('dddddddd-0110-0110-0110-dddddddd0110', null) $$,
  'P0001', null, 'an unknown project is rejected');

reset role;
select * from finish();
rollback;
