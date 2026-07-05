begin;
select plan(19);

-- ============================================================================
-- Spec 161 U1 / ADR 0060 — per-level rate foundation. Worker skill `level`
--   (senior/mid/junior/apprentice) + the editable, SEEDED `sell_rate_table`
--   (per level: baht cost band / internal-WP sell / external-WP sell — MONEY,
--   zero authenticated grant, operator-tuned). set_worker_level + set_sell_rate
--   are SECURITY DEFINER, super_admin only (grading + rates are operator
--   economics — anti-favoritism, ADR 0060 §5). Nothing reads the rates yet (U3).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110198', 'super@rate-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330198', 'pm@rate-test.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880198', 'vis@rate-test.local',   '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110198';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330198';
-- '8888…' stays visitor.

insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by)
  values ('aaaa0198-0198-0198-0198-aaaaaaaa0198', 'ช่าง ก', 'monthly', 'permanent', null, null, 0, true,
          '11111111-1111-1111-1111-111111110198');

-- A. Catalog + seed (as owner).
select enum_has_labels('public', 'worker_level',
  array['senior', 'mid', 'junior', 'apprentice'], 'worker_level enum labels');
select has_column('public', 'workers', 'level', 'workers has a level column');
select col_type_is('public', 'workers', 'level', 'worker_level', 'workers.level is worker_level');
select has_table('public', 'sell_rate_table', 'sell_rate_table exists');
select col_is_pk('public', 'sell_rate_table', 'level', 'sell_rate_table.level is the PK');
select is((select count(*)::int from public.sell_rate_table), 4,
  'the sell-rate table is seeded with one row per level');
select is((select internal_sell from public.sell_rate_table where level='senior'),
  800::numeric, 'senior internal_sell seed default is 800');
-- MONEY posture: sell prices carry no authenticated grant (read via admin client).
select ok(not has_table_privilege('authenticated', 'public.sell_rate_table', 'SELECT'),
  'authenticated has no SELECT on sell_rate_table (money posture)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- B. set_worker_level — super grades; gate.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110198"}';
select lives_ok(
  $$ select public.set_worker_level('aaaa0198-0198-0198-0198-aaaaaaaa0198', 'senior') $$,
  'super_admin sets a worker level');
select is(
  (select level from public.workers where id='aaaa0198-0198-0198-0198-aaaaaaaa0198'),
  'senior'::public.worker_level, 'workers.level is set');
select is(
  (select count(*)::int from public.audit_log
     where target_id='aaaa0198-0198-0198-0198-aaaaaaaa0198'
       and payload->>'kind'='level_change'),
  1, 'the level change is audited');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330198"}';
select throws_ok(
  $$ select public.set_worker_level('aaaa0198-0198-0198-0198-aaaaaaaa0198', 'mid') $$,
  '42501', null, 'project_manager cannot set a worker level');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880198"}';
select throws_ok(
  $$ select public.set_worker_level('aaaa0198-0198-0198-0198-aaaaaaaa0198', 'mid') $$,
  '42501', null, 'visitor cannot set a worker level');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110198"}';
select throws_ok(
  $$ select public.set_worker_level('dddddddd-0198-0198-0198-dddddddd0198', 'mid') $$,
  'P0001', null, 'an unknown worker is rejected');

-- C. set_sell_rate — super tunes; gate.
select lives_ok(
  $$ select public.set_sell_rate('senior', 660, 820, 970) $$,
  'super_admin updates a level''s sell rates');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330198"}';
select throws_ok(
  $$ select public.set_sell_rate('mid', 560, 710, 860) $$,
  '42501', null, 'project_manager cannot set sell rates');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110198"}';
select throws_ok(
  $$ select public.set_sell_rate('senior', -1, 820, 970) $$,
  'P0001', null, 'a negative rate is rejected');

reset role;

-- D. The update landed + was audited (read as owner — zero authenticated grant).
select is((select internal_sell from public.sell_rate_table where level='senior'),
  820::numeric, 'set_sell_rate updated the senior internal_sell to 820');
select is(
  (select count(*)::int from public.audit_log
     where target_table='sell_rate_table' and action='update'),
  1, 'the sell-rate change is audited');

select * from finish();
rollback;
