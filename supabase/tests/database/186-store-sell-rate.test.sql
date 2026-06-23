begin;
select plan(15);

-- ============================================================================
-- Spec 178 U1 — store margin layer: per-item sell rate (transfer price).
--   item_sell_rates (one flat sell rate per catalog item; MONEY posture = zero
--   authenticated grant, like sell_rate_table) + set_item_sell_rate(item, rate)
--   definer: super_admin only, upsert, audit row, anon EXECUTE revoked.
--   The sell-rate model the later issue-sell snapshot + wp_profit fold read.
-- Zero-grant reads (the persisted rate) happen as OWNER — before `set role` or
-- after `reset role`; only the setter CALLS run under `role authenticated`.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('19191919-1919-1919-1919-000000000186', 'super@srate.local', '{}'::jsonb),
  ('17171717-1717-1717-1717-000000000186', 'dir@srate.local',   '{}'::jsonb),
  ('11111111-1111-1111-1111-000000000186', 'pm@srate.local',    '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000186', 'proc@srate.local',  '{}'::jsonb);
update public.users set role='super_admin'      where id='19191919-1919-1919-1919-000000000186';
update public.users set role='project_director' where id='17171717-1717-1717-1717-000000000186';
update public.users set role='project_manager'  where id='11111111-1111-1111-1111-000000000186';
update public.users set role='procurement'      where id='13131313-1313-1313-1313-000000000186';

insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000186', 'electrical', 'วัสดุขายทดสอบ', 'ชิ้น', true);

-- A. Structure (read as owner).
select has_table('public', 'item_sell_rates', 'item_sell_rates table exists');
select is((select relrowsecurity from pg_class where oid='public.item_sell_rates'::regclass),
  true, 'RLS enabled on item_sell_rates');
select ok(to_regprocedure('public.set_item_sell_rate(uuid, numeric)') is not null,
  'set_item_sell_rate exists');
select is(has_function_privilege('anon',
  'public.set_item_sell_rate(uuid, numeric)', 'EXECUTE'),
  false, 'anon cannot execute set_item_sell_rate');
-- MONEY posture: no authenticated SELECT on the rate table (zero grant).
select ok(not has_table_privilege('authenticated', 'public.item_sell_rates', 'SELECT'),
  'authenticated has no SELECT on item_sell_rates (zero-grant money posture)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- B. super_admin sets then upserts the sell rate.
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000186"}';
select lives_ok(
  $$ select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000186', 42.50) $$,
  'super_admin sets a sell rate');
select lives_ok(
  $$ select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000186', 55.00) $$,
  'super_admin updates the sell rate (upsert)');

-- C. Validations (22023, the store family code).
select throws_ok(
  $$ select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000186', -1) $$,
  '22023', null, 'negative sell rate rejected (22023)');
select throws_ok(
  $$ select public.set_item_sell_rate('ffffffff-0000-0000-0000-000000000186', 10) $$,
  '22023', null, 'unknown catalog item rejected (22023)');

-- D. project_director may ALSO set (operator 2026-06-23 — PD is the exec tier that
-- already sees the store P&L). It sets the same 55.00 (persisted assert unchanged).
set local "request.jwt.claims" = '{"sub": "17171717-1717-1717-1717-000000000186"}';
select lives_ok(
  $$ select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000186', 55.00) $$,
  'project_director sets a sell rate');

-- E. Deny: NOT project_manager, NOT procurement (only super + director).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000186"}';
select throws_ok(
  $$ select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000186', 10) $$,
  '42501', null, 'project_manager cannot set a sell rate (42501)');
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000186"}';
select throws_ok(
  $$ select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000186', 10) $$,
  '42501', null, 'procurement cannot set a sell rate (42501)');

reset role;

-- E. The upsert landed + was audited (read as owner — zero authenticated grant).
select is(
  (select sell_rate from public.item_sell_rates
     where catalog_item_id='ee000000-0000-0000-0000-000000000186'),
  55.00::numeric, 'sell rate persisted = 55.00 after upsert');
select is(
  (select count(*)::int from public.item_sell_rates
     where catalog_item_id='ee000000-0000-0000-0000-000000000186'),
  1, 'upsert keeps exactly one row (no duplicate)');
select is(
  (select count(*)::int from public.audit_log
     where target_table='item_sell_rates' and action='update'
       and target_id='ee000000-0000-0000-0000-000000000186'),
  3, 'all three successful sets were audited (2 super + 1 director)');

select * from finish();
rollback;
