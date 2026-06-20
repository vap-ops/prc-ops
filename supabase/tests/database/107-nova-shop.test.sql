begin;
select plan(22);

-- ============================================================================
-- Spec 161 U6a / ADR 0060 §4 — the Nova shop (coin SINK). Per-item coin pricing
--   (points, no baht peg) + redemption (spend = a negative shop_redemption posting
--   via post_coins). upsert_shop_item / set_shop_item_active / redeem_shop_item are
--   super_admin only. redeem checks the balance + item active; records a
--   shop_redemptions row linking the posting. (U6b narrows balance → spendable.)
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110107', 'super@shop.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330107', 'pm@shop.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880107', 'vis@shop.local',   '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110107';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330107';
-- '8888…' stays visitor.

-- Buyer (500 coins) + a poor worker (50). Coins seeded with an OLD occurred_at so
-- they are VESTED (forward-compatible with U6b, which restricts redeem to vested).
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, created_by) values
  ('e1110107-0107-0107-0107-e1e1e1e10107', 'ผู้ซื้อ',   'dc', null, null, 0, true,
   '11111111-1111-1111-1111-111111110107'),
  ('e2220107-0107-0107-0107-e2e2e2e20107', 'เงินน้อย', 'dc', null, null, 0, true,
   '11111111-1111-1111-1111-111111110107');
insert into public.coin_postings (worker_id, source, amount, reason, occurred_at, created_by) values
  ('e1110107-0107-0107-0107-e1e1e1e10107', 'profit_share', 500, 'seed', timestamptz '2020-01-01',
   '11111111-1111-1111-1111-111111110107'),
  ('e2220107-0107-0107-0107-e2e2e2e20107', 'profit_share', 50,  'seed', timestamptz '2020-01-01',
   '11111111-1111-1111-1111-111111110107');

-- Items: it01 active (redeem target), it02 inactive.
insert into public.shop_items (id, name, price_coins, active, created_by) values
  ('f1110107-0107-0107-0107-f1f1f1f10107', 'หมวกนิรภัย', 100, true,
   '11111111-1111-1111-1111-111111110107'),
  ('f2220107-0107-0107-0107-f2f2f2f20107', 'ของปิดการขาย', 100, false,
   '11111111-1111-1111-1111-111111110107');

-- ============================================================================
-- A. Catalog (as owner).
-- ============================================================================
select has_table('public', 'shop_items', 'shop_items table exists');
select has_table('public', 'shop_redemptions', 'shop_redemptions table exists');
select is((select prosecdef from pg_proc
            where oid = 'public.upsert_shop_item(text,numeric,text,integer,uuid)'::regprocedure),
  true, 'upsert_shop_item is SECURITY DEFINER');
select is((select prosecdef from pg_proc
            where oid = 'public.redeem_shop_item(uuid,uuid)'::regprocedure),
  true, 'redeem_shop_item is SECURITY DEFINER');
select ok('shop_redemption' = any(enum_range(null::public.coin_source)::text[]),
  'coin_source has the shop_redemption sink value');
select ok(has_table_privilege('authenticated', 'public.shop_items', 'SELECT'),
  'shop_items catalog is readable by authenticated (points, not money)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. upsert_shop_item — super creates + updates; gate; validation.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110107"}';
select lives_ok(
  $$ select public.upsert_shop_item('ของรางวัลใหม่', 250) $$,
  'super_admin creates a shop item');
select is((select count(*)::int from public.shop_items where name = 'ของรางวัลใหม่'),
  1, 'the created item exists');
select lives_ok(
  $$ select public.upsert_shop_item('ของปิดการขาย', 200, null, 0,
       'f2220107-0107-0107-0107-f2f2f2f20107') $$,
  'super_admin updates an existing item');
select is((select price_coins from public.shop_items
            where id = 'f2220107-0107-0107-0107-f2f2f2f20107'),
  200.0000::numeric, 'the item price was updated to 200');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330107"}';
select throws_ok(
  $$ select public.upsert_shop_item('แอบสร้าง', 100) $$,
  '42501', null, 'project_manager cannot upsert a shop item');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880107"}';
select throws_ok(
  $$ select public.upsert_shop_item('แอบสร้าง', 100) $$,
  '42501', null, 'visitor cannot upsert a shop item');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110107"}';
select throws_ok(
  $$ select public.upsert_shop_item('ฟรี', 0) $$,
  'P0001', null, 'a non-positive price is rejected');

-- ============================================================================
-- C. redeem_shop_item — spend, gate, insufficient, inactive, unknown.
-- ============================================================================
select lives_ok(
  $$ select public.redeem_shop_item('e1110107-0107-0107-0107-e1e1e1e10107',
       'f1110107-0107-0107-0107-f1f1f1f10107') $$,
  'super_admin redeems an active item for the buyer');
select is(public.coin_balance('e1110107-0107-0107-0107-e1e1e1e10107'),
  400::numeric, 'buyer balance = 500 - 100 = 400');
select is((select count(*)::int from public.shop_redemptions
            where worker_id = 'e1110107-0107-0107-0107-e1e1e1e10107'),
  1, 'a shop_redemptions row was recorded');
select is((select amount from public.coin_postings
            where worker_id = 'e1110107-0107-0107-0107-e1e1e1e10107' and source = 'shop_redemption'),
  -100.0000::numeric, 'a shop_redemption posting of -100 exists');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330107"}';
select throws_ok(
  $$ select public.redeem_shop_item('e1110107-0107-0107-0107-e1e1e1e10107',
       'f1110107-0107-0107-0107-f1f1f1f10107') $$,
  '42501', null, 'project_manager cannot redeem');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110107"}';
select throws_ok(
  $$ select public.redeem_shop_item('e2220107-0107-0107-0107-e2e2e2e20107',
       'f1110107-0107-0107-0107-f1f1f1f10107') $$,
  'P0001', null, 'insufficient balance (50 < 100) is rejected');
select throws_ok(
  $$ select public.redeem_shop_item('e1110107-0107-0107-0107-e1e1e1e10107',
       'f2220107-0107-0107-0107-f2f2f2f20107') $$,
  'P0001', null, 'an inactive item cannot be redeemed');
select throws_ok(
  $$ select public.redeem_shop_item('dddddddd-0107-0107-0107-dddddddd0107',
       'f1110107-0107-0107-0107-f1f1f1f10107') $$,
  'P0001', null, 'an unknown worker is rejected');
select throws_ok(
  $$ select public.redeem_shop_item('e1110107-0107-0107-0107-e1e1e1e10107',
       'dddddddd-0107-0107-0107-dddddddd0107') $$,
  'P0001', null, 'an unknown item is rejected');

reset role;

select * from finish();
rollback;
