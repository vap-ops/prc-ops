begin;
select plan(28);

-- ============================================================================
-- Spec 160 U2 / ADR 0061 (invariants 2 + 3) — event-sourced coin-ledger
--   skeleton. coin_postings is an append-only per-worker event log (RLS on,
--   zero write grant — RPC-only, no UPDATE/DELETE); coin_source is a pluggable
--   enum of earn-sources; the balance is DERIVED by coin_balance() (never a
--   stored integer); a clawback is a NEGATIVE posting, not an edit. post_coins
--   (SECURITY DEFINER, super_admin only -> else 42501) appends a posting.
--   Self-auditing (the ledger is the trail) — no audit_log row. NO economics:
--   sources are named, not valued.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110196', 'super@coin-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330196', 'pm@coin-test.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220196', 'sa@coin-test.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880196', 'vis@coin-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110196';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330196';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220196';
-- '8888…' stays visitor.

insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by)
  values ('aaaa0196-0196-0196-0196-aaaaaaaa0196', 'ช่าง ก', 'monthly', 'permanent', null, null, 0, true,
          '11111111-1111-1111-1111-111111110196');

-- ---------------------------------------------------------------------------
-- A. Catalog (as the migration/owner role).
-- ---------------------------------------------------------------------------
select has_table('public', 'coin_postings', 'coin_postings table exists');
select has_column('public', 'coin_postings', 'worker_id', 'has worker_id');
select has_column('public', 'coin_postings', 'source', 'has source');
select has_column('public', 'coin_postings', 'amount', 'has amount');
select has_column('public', 'coin_postings', 'reason', 'has reason');
select has_column('public', 'coin_postings', 'occurred_at', 'has occurred_at');
select fk_ok('public', 'coin_postings', 'worker_id', 'public', 'workers', 'id',
  'coin_postings.worker_id FK references workers.id');
select enum_has_labels('public', 'coin_source',
  array['profit_share', 'savers_bonus', 'behavior_bonus', 'shop_redemption', 'confiscation'],
  'coin_source enum carries the earn-sources + the shop_redemption/confiscation sinks (spec 161 U6a/U6b)');

-- Append-only + zero write grant (RPC-only).
select ok(not has_table_privilege('authenticated', 'public.coin_postings', 'UPDATE'),
  'authenticated has no UPDATE privilege on coin_postings');
select ok(not has_table_privilege('authenticated', 'public.coin_postings', 'DELETE'),
  'authenticated has no DELETE privilege on coin_postings');
select ok(not has_table_privilege('authenticated', 'public.coin_postings', 'INSERT'),
  'authenticated has no INSERT privilege on coin_postings (RPC-only)');

select is((select prosecdef from pg_proc
            where oid='public.post_coins(uuid,public.coin_source,numeric,text,timestamptz,uuid)'::regprocedure),
  true, 'post_coins is SECURITY DEFINER');
select ok(to_regprocedure('public.coin_balance(uuid)') is not null,
  'coin_balance(uuid) exists');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- B. super_admin posts; the balance is derived from the postings.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110196"}';

select lives_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'profit_share', 100, 'ส่วนแบ่งกำไรโครงการ') $$,
  'super_admin posts a profit_share coin entry');
select is(
  (select public.coin_balance('aaaa0196-0196-0196-0196-aaaaaaaa0196')),
  100::numeric, 'coin_balance derives 100 from the single posting');

select lives_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'savers_bonus', 50, 'โบนัสออม') $$,
  'super_admin posts a second entry (other source)');
select is(
  (select public.coin_balance('aaaa0196-0196-0196-0196-aaaaaaaa0196')),
  150::numeric, 'coin_balance sums both postings');

-- A clawback is a NEGATIVE posting, never an edit.
select lives_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'behavior_bonus', -30, 'หักคืน') $$,
  'a clawback is posted as a negative entry');
select is(
  (select public.coin_balance('aaaa0196-0196-0196-0196-aaaaaaaa0196')),
  120::numeric, 'coin_balance nets the negative posting');
select is(
  (select count(*)::int from public.coin_postings
     where worker_id='aaaa0196-0196-0196-0196-aaaaaaaa0196'),
  3, 'the append-only ledger grew to three postings');

-- ---------------------------------------------------------------------------
-- C. Validation (super_admin context).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'profit_share', 0, 'ศูนย์') $$,
  'P0001', null, 'a zero-amount posting is rejected');
select throws_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'profit_share', 10, '   ') $$,
  'P0001', null, 'a blank reason is rejected');
select throws_ok(
  $$ select public.post_coins('dddddddd-0196-0196-0196-dddddddd0196',
       'profit_share', 10, 'ไม่มีคน') $$,
  'P0001', null, 'an unknown worker is rejected');

-- ---------------------------------------------------------------------------
-- D. Role gate — only super_admin posts.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330196"}';
select throws_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'profit_share', 10, 'พีเอ็ม') $$,
  '42501', null, 'project_manager cannot post coins');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220196"}';
select throws_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'profit_share', 10, 'ไซต์') $$,
  '42501', null, 'site_admin cannot post coins');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880196"}';
select throws_ok(
  $$ select public.post_coins('aaaa0196-0196-0196-0196-aaaaaaaa0196',
       'profit_share', 10, 'วิส') $$,
  '42501', null, 'visitor cannot post coins');

-- ---------------------------------------------------------------------------
-- E. RLS read — super_admin sees the ledger; a non-operator sees nothing.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110196"}';
select is(
  (select count(*)::int from public.coin_postings
     where worker_id='aaaa0196-0196-0196-0196-aaaaaaaa0196'),
  3, 'super_admin reads the ledger');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330196"}';
select is(
  (select count(*)::int from public.coin_postings
     where worker_id='aaaa0196-0196-0196-0196-aaaaaaaa0196'),
  0, 'a non-operator reads zero coin rows (RLS)');

reset role;

select * from finish();
rollback;
