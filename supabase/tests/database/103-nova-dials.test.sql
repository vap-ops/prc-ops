begin;
select plan(13);

-- ============================================================================
-- Spec 161 U4a / ADR 0060 §3 + build-decision (a) — the settlement multiplier
--   dial. nova_dials is the key/value home for every economic dial (seeded,
--   editable — "tune anytime", not a hardcoded constant); U4a seeds only
--   coin_multiplier (1.0 placeholder — operator calibrates vs utilization before
--   go-live). MONEY/economics posture: zero authenticated grant. set_nova_dial is
--   super_admin-only (anti-favoritism §5, no PM ref → 90/91 untouched), update-only
--   on a seeded key, value >= 0, audited.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110765', 'super@dial.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330765', 'pm@dial.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880765', 'vis@dial.local',   '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110765';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330765';
-- '8888…' stays visitor.

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_table('public', 'nova_dials', 'nova_dials exists');
select col_is_pk('public', 'nova_dials', 'dial_key', 'dial_key is the PK');
select has_column('public', 'nova_dials', 'value', 'nova_dials has value');
select is((select prosecdef from pg_proc
            where oid = 'public.set_nova_dial(text,numeric)'::regprocedure),
  true, 'set_nova_dial is SECURITY DEFINER');

-- ============================================================================
-- B. Seed — coin_multiplier present at the placeholder default 1.0.
-- ============================================================================
select is((select value from public.nova_dials where dial_key = 'coin_multiplier'),
  1.0::numeric, 'coin_multiplier seeded at 1.0');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- C. Money posture — authenticated has no SELECT on nova_dials.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110765"}';
select throws_ok(
  $$ select value from public.nova_dials limit 1 $$,
  '42501', null, 'authenticated cannot read nova_dials (zero grant)');

-- ============================================================================
-- D. set_nova_dial — super updates; gate; validation.
-- ============================================================================
select lives_ok(
  $$ select public.set_nova_dial('coin_multiplier', 1.5) $$,
  'super_admin tunes the multiplier');
select throws_ok(
  $$ select public.set_nova_dial('coin_multiplier', -1) $$,
  'P0001', null, 'a negative value is rejected');
select throws_ok(
  $$ select public.set_nova_dial('not_a_dial', 1) $$,
  'P0001', null, 'an unknown (unseeded) dial key is rejected');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330765"}';
select throws_ok(
  $$ select public.set_nova_dial('coin_multiplier', 2) $$,
  '42501', null, 'project_manager cannot tune a dial');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880765"}';
select throws_ok(
  $$ select public.set_nova_dial('coin_multiplier', 2) $$,
  '42501', null, 'visitor cannot tune a dial');

reset role;

-- ============================================================================
-- E. The update landed (super's 1.5) and was audited.
-- ============================================================================
select is((select value from public.nova_dials where dial_key = 'coin_multiplier'),
  1.5::numeric, 'the multiplier now reads the tuned value (1.5)');
select is(
  (select count(*)::int from public.audit_log
     where target_table = 'nova_dials'
       and payload->>'key' = 'coin_multiplier'),
  1, 'the dial change was audited once');

select * from finish();
rollback;
