begin;
select plan(21);

-- ============================================================================
-- Spec 149 U1 / ADR 0057 — gl_accounts (chart of accounts).
-- Pins: catalog (table/PK/RLS/zero-policy + the gl_account_type enum); the
-- CHECKs (normal_side domain, code length, no self-parent); the skeleton seed
-- (a control account postable, a class heading non-postable); the zero
-- authenticated grant (money domain); upsert_gl_account (pm/super gate —
-- site_admin AND visitor refused 42501; pm happy; P0001 on bad normal_side +
-- unknown parent); the audit row; anon denied.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110357', 'pm@glacct.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220357', 'sa@glacct.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330357', 'vi@glacct.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110357';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220357';
-- third user stays visitor

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_type('public', 'gl_account_type', 'gl_account_type enum exists');
select enum_has_labels(
  'public', 'gl_account_type',
  array['asset', 'liability', 'equity', 'income', 'expense'],
  'gl_account_type has the five account classes');
select has_table('public', 'gl_accounts', 'gl_accounts exists');
select col_is_pk('public', 'gl_accounts', 'id', 'gl_accounts.id is the PK');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.gl_accounts'::regclass),
  'RLS enabled on gl_accounts');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'gl_accounts'),
  0::bigint, 'gl_accounts has no policies (zero grant — RPC/admin only)');

-- ============================================================================
-- B. CHECK invariants (run as table owner — RLS bypassed, the CHECK fires).
-- ============================================================================
select throws_ok(
  $$ insert into public.gl_accounts (code, name_th, account_type, normal_side)
     values ('TAPNS', 'bad side', 'asset', 'sideways') $$,
  '23514', null, 'normal_side outside {debit,credit} is rejected');
select throws_ok(
  $$ insert into public.gl_accounts (code, name_th, account_type, normal_side)
     values ('123456789012345678901', 'too long code', 'asset', 'debit') $$,
  '23514', null, 'code longer than 20 chars is rejected');
select throws_ok(
  $$ insert into public.gl_accounts (id, code, name_th, account_type, normal_side, parent_id)
     values ('aaaaaaaa-0000-4000-8000-000000000357', 'TAPSELF', 'self parent',
             'asset', 'debit', 'aaaaaaaa-0000-4000-8000-000000000357') $$,
  '23514', null, 'a self-parent (parent_id = id) is rejected');

-- ============================================================================
-- C. Skeleton seed present (the migration ran before tests).
-- ============================================================================
select is(
  (select is_postable from public.gl_accounts where code = '2110'),
  true, 'control account 2110 (AP - DC clearing) exists and is postable');
select is(
  (select is_postable from public.gl_accounts where code = '1000'),
  false, 'class heading 1000 (Assets) exists and is NOT postable');

-- ============================================================================
-- D. Zero grant (authenticated = site_admin): table unreadable / unwritable.
-- ============================================================================
grant insert  on _tap_buf to authenticated, anon;
grant select  on _tap_buf to authenticated, anon;
grant usage   on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220357"}';

select throws_ok(
  $$ select code from public.gl_accounts limit 1 $$,
  '42501', null, 'authenticated cannot read gl_accounts (zero grant)');
select throws_ok(
  $$ insert into public.gl_accounts (code, name_th, account_type, normal_side)
     values ('TAPX', 'x', 'asset', 'debit') $$,
  '42501', null, 'authenticated cannot INSERT gl_accounts directly');

-- ============================================================================
-- E. RPC role gate: site_admin AND visitor refused (money domain).
-- ============================================================================
select throws_ok(
  $$ select public.upsert_gl_account('TAP-GL-X', 'x', null, 'asset', 'debit') $$,
  '42501', null, 'upsert_gl_account refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330357"}';
select throws_ok(
  $$ select public.upsert_gl_account('TAP-GL-X', 'x', null, 'asset', 'debit') $$,
  '42501', null, 'upsert_gl_account refuses visitor');

-- ============================================================================
-- F. Happy path + guards (project_manager).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110357"}';
select lives_ok(
  $$ select public.upsert_gl_account(
       'TAP-GL-1', 'บัญชีทดสอบ', 'Test account', 'asset', 'debit', '1000') $$,
  'project_manager upserts a gl account under a known parent');
select throws_ok(
  $$ select public.upsert_gl_account('TAP-GL-2', 'x', null, 'asset', 'middle') $$,
  'P0001', null, 'refuses an invalid normal_side');
select throws_ok(
  $$ select public.upsert_gl_account('TAP-GL-3', 'x', null, 'asset', 'debit', 'NOPE') $$,
  'P0001', null, 'refuses an unknown parent code');

-- ============================================================================
-- G. Effects + audit (reset to owner to read past the zero-grant posture).
-- ============================================================================
reset role;
select is(
  (select count(*) from public.gl_accounts where code = 'TAP-GL-1'),
  1::bigint, 'the upserted account exists');
select is(
  (select count(*) from public.audit_log where action = 'gl_account_upsert'),
  1::bigint, 'exactly one gl_account_upsert audit row (the happy path only)');
select is(
  (select parent_id from public.gl_accounts where code = 'TAP-GL-1'),
  (select id from public.gl_accounts where code = '1000'),
  'the upserted account resolved its parent_id from the parent code');

-- ============================================================================
-- H. Anon denied entirely.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ select id from public.gl_accounts limit 1 $$,
  '42501', null, 'anon cannot read gl_accounts');

reset role;
select * from finish();
rollback;
