begin;
select plan(25);

-- ============================================================================
-- Spec 161 U6b / ADR 0060 §6 + decision c + design-rules 1/6/7 — the TRUST layer.
--   Vesting is time-based (+ the external lock): an internal DC's recently-earned
--   coins (within vesting_tail_days) are UNVESTED; an external DC's whole balance is
--   locked. coin_vested/spendable_balance derive it; redeem spends only spendable.
--   confiscate_coins forfeits ONLY unvested coins (vested = the worker's to keep),
--   reason from a NARROW enum. award_savers_bonus rewards continued holding.
--   Dials seeded: vesting_tail_days 365, savers_bonus_rate 0.02.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110108', 'super@vest.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550108', 'dir@vest.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330108', 'pm@vest.local',    '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110108';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550108';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330108';

-- A dc_temporary contractor → external tenure (the lock).
insert into public.contractors (id, name, contractor_category, contractor_subtype, created_by)
  values ('cc550108-0108-0108-0108-cc55cc550108', 'รับเหมาชั่วคราว', 'dc', 'dc_temporary',
          '11111111-1111-1111-1111-111111110108');

insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by) values
  ('e1110108-0108-0108-0108-e1e1e1e10108', 'ภายในผสม',   'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110108'),
  ('e2220108-0108-0108-0108-e2e2e2e20108', 'ภายนอกล็อก', 'daily', 'permanent',
   'cc550108-0108-0108-0108-cc55cc550108', null, 0, true, '11111111-1111-1111-1111-111111110108'),
  ('e3330108-0108-0108-0108-e3e3e3e30108', 'ยึดเหรียญ',  'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110108'),
  ('e4440108-0108-0108-0108-e4e4e4e40108', 'ครบกำหนด',   'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110108'),
  ('e5550108-0108-0108-0108-e5e5e5e50108', 'นักออม',     'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110108'),
  ('e6660108-0108-0108-0108-e6e6e6e60108', 'ใช้จ่าย',    'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110108');

-- ADR 0062 U2: external = the WORKER's ชั่วคราว arrangement (was the contractor's
-- dc_temporary subtype). Mark the locked external DC accordingly.
update public.workers set employment_type = 'temporary'
 where contractor_id = 'cc550108-0108-0108-0108-cc55cc550108';

-- Coins. OLD ('2020-01-01') = past the 365d tail → vested. RECENT ('2026-06-20') =
-- inside the tail → unvested. (now() is 2026-06-21.)
insert into public.coin_postings (worker_id, source, amount, reason, occurred_at, created_by) values
  ('e1110108-0108-0108-0108-e1e1e1e10108', 'profit_share', 1000, 'old',    timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110108'),
  ('e1110108-0108-0108-0108-e1e1e1e10108', 'profit_share', 500,  'recent', timestamptz '2026-06-20', '11111111-1111-1111-1111-111111110108'),
  ('e2220108-0108-0108-0108-e2e2e2e20108', 'profit_share', 800,  'ext',    timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110108'),
  ('e3330108-0108-0108-0108-e3e3e3e30108', 'profit_share', 1000, 'old',    timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110108'),
  ('e3330108-0108-0108-0108-e3e3e3e30108', 'profit_share', 500,  'recent', timestamptz '2026-06-20', '11111111-1111-1111-1111-111111110108'),
  ('e4440108-0108-0108-0108-e4e4e4e40108', 'profit_share', 1000, 'old',    timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110108'),
  ('e5550108-0108-0108-0108-e5e5e5e50108', 'profit_share', 1000, 'old',    timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110108'),
  -- spender: a prior savers_bonus then a LATER redemption → blocked next bonus.
  ('e6660108-0108-0108-0108-e6e6e6e60108', 'profit_share',   1000, 'old',   timestamptz '2020-01-01', '11111111-1111-1111-1111-111111110108'),
  ('e6660108-0108-0108-0108-e6e6e6e60108', 'savers_bonus',   20,   'bonus', timestamptz '2026-06-10', '11111111-1111-1111-1111-111111110108'),
  ('e6660108-0108-0108-0108-e6e6e6e60108', 'shop_redemption', -50, 'spend', timestamptz '2026-06-15', '11111111-1111-1111-1111-111111110108');

-- An active item (price 600) for the lock/redeem tests.
insert into public.shop_items (id, name, price_coins, active, created_by) values
  ('f1110108-0108-0108-0108-f1f1f1f10108', 'รางวัลใหญ่', 600, true,
   '11111111-1111-1111-1111-111111110108');

-- ============================================================================
-- A. Catalog (as owner).
-- ============================================================================
select has_function('public', 'coin_unvested_balance', array['uuid'], 'coin_unvested_balance exists');
select has_function('public', 'coin_vested_balance', array['uuid'], 'coin_vested_balance exists');
select has_function('public', 'coin_spendable_balance', array['uuid'], 'coin_spendable_balance exists');
select is((select prosecdef from pg_proc
            where oid='public.confiscate_coins(uuid,public.confiscation_reason,text)'::regprocedure),
  true, 'confiscate_coins is SECURITY DEFINER');
select is((select prosecdef from pg_proc
            where oid='public.award_savers_bonus(uuid)'::regprocedure),
  true, 'award_savers_bonus is SECURITY DEFINER');
select enum_has_labels('public', 'confiscation_reason',
  array['fraud', 'theft', 'gross_misconduct', 'defect_rework'],
  'confiscation_reason is the narrow explicit list');
select ok('confiscation' = any(enum_range(null::public.coin_source)::text[]),
  'coin_source has the confiscation sink value');
select has_table('public', 'coin_confiscations', 'coin_confiscations table exists');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110108"}';

-- ============================================================================
-- B. Vesting — internal (time-based) vs external (locked).
-- ============================================================================
select is(public.coin_unvested_balance('e1110108-0108-0108-0108-e1e1e1e10108'),
  500::numeric, 'internal unvested = the recent 500 (within the tail)');
select is(public.coin_vested_balance('e1110108-0108-0108-0108-e1e1e1e10108'),
  1000::numeric, 'internal vested = the old 1000 (past the tail) — theirs to keep');
select is(public.coin_spendable_balance('e1110108-0108-0108-0108-e1e1e1e10108'),
  1000::numeric, 'internal spendable = vested 1000');
select is(public.coin_unvested_balance('e2220108-0108-0108-0108-e2e2e2e20108'),
  800::numeric, 'external unvested = whole balance (locked)');
select is(public.coin_vested_balance('e2220108-0108-0108-0108-e2e2e2e20108'),
  0::numeric, 'external vested = 0');
select is(public.coin_spendable_balance('e2220108-0108-0108-0108-e2e2e2e20108'),
  0::numeric, 'external spendable = 0 (locked until invited internal)');

-- ============================================================================
-- C. Redeem respects the lock (spendable, not raw balance).
-- ============================================================================
select throws_ok(
  $$ select public.redeem_shop_item('e2220108-0108-0108-0108-e2e2e2e20108',
       'f1110108-0108-0108-0108-f1f1f1f10108') $$,
  'P0001', null, 'external cannot redeem (spendable 0 < 600)');
select lives_ok(
  $$ select public.redeem_shop_item('e1110108-0108-0108-0108-e1e1e1e10108',
       'f1110108-0108-0108-0108-f1f1f1f10108') $$,
  'internal redeems from vested (1000 >= 600)');

-- ============================================================================
-- D. Confiscation — only the unvested; vested is kept; narrow + gated.
-- ============================================================================
select lives_ok(
  $$ select public.confiscate_coins('e3330108-0108-0108-0108-e3e3e3e30108', 'fraud', 'หลักฐานชัดเจน') $$,
  'super confiscates the unvested coins for cause');
select is(public.coin_balance('e3330108-0108-0108-0108-e3e3e3e30108'),
  1000::numeric, 'balance = 1000 (the unvested 500 confiscated, vested 1000 kept)');
select is((select amount from public.coin_postings
            where worker_id='e3330108-0108-0108-0108-e3e3e3e30108' and source='confiscation'),
  -500.0000::numeric, 'a confiscation posting of -500 exists');
select throws_ok(
  $$ select public.confiscate_coins('e4440108-0108-0108-0108-e4e4e4e40108', 'theft', null) $$,
  'P0001', null, 'a fully-vested worker has no unvested coins to confiscate (safe)');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330108"}';
select throws_ok(
  $$ select public.confiscate_coins('e3330108-0108-0108-0108-e3e3e3e30108', 'fraud', null) $$,
  '42501', null, 'project_manager cannot confiscate');

-- ============================================================================
-- E. Saver's bonus — rewards holding; blocked if spent since the last bonus.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110108"}';
select lives_ok(
  $$ select public.award_savers_bonus('e5550108-0108-0108-0108-e5e5e5e50108') $$,
  'super awards the saver bonus');
select is(public.coin_balance('e5550108-0108-0108-0108-e5e5e5e50108'),
  1020::numeric, 'balance = 1000 + (1000 × 0.02) = 1020');
select throws_ok(
  $$ select public.award_savers_bonus('e6660108-0108-0108-0108-e6e6e6e60108') $$,
  'P0001', null, 'a worker who spent since their last bonus is not rewarded');

-- ============================================================================
-- F. Vesting derives are gated (super/director only).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330108"}';
select throws_ok(
  $$ select public.coin_unvested_balance('e1110108-0108-0108-0108-e1e1e1e10108') $$,
  '42501', null, 'project_manager cannot read vesting balances');

reset role;

select * from finish();
rollback;
