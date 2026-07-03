begin;
select plan(5);

-- ============================================================================
-- Spec 252 U1 — wp_profit() gate widening: super_admin/project_director-only
-- becomes is_manager() ∨ accounting (accounting gets READ of per-WP P&L; PM is
-- admitted too — the spec-253 finance drill is a PM∪accounting surface and the
-- old gate would have refused PMs). Null-safe, fail-closed.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111252', 'acct@sp252.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222252', 'pm@sp252.local', '{}'::jsonb),
  ('a3333333-3333-3333-3333-333333333252', 'sa@sp252.local', '{}'::jsonb);
update public.users set role='accounting'      where id='a1111111-1111-1111-1111-111111111252';
update public.users set role='project_manager' where id='a2222222-2222-2222-2222-222222222252';
update public.users set role='site_admin'      where id='a3333333-3333-3333-3333-333333333252';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000252', 'SP252', 'โครงการ 252');
insert into public.work_packages (id, project_id, code, name) values
  ('bb000000-0000-0000-0000-000000000252', 'aa000000-0000-0000-0000-000000000252', 'WP-252', 'งาน 252');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- 1. accounting can read wp_profit.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111252"}';
select lives_ok(
  $$ select * from public.wp_profit('bb000000-0000-0000-0000-000000000252') $$,
  'accounting can call wp_profit');

-- 2. project_manager can read wp_profit (needed by the spec-253 drill).
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222252"}';
select lives_ok(
  $$ select * from public.wp_profit('bb000000-0000-0000-0000-000000000252') $$,
  'project_manager can call wp_profit');

-- 3. site_admin is still refused.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333252"}';
select throws_ok(
  $$ select * from public.wp_profit('bb000000-0000-0000-0000-000000000252') $$,
  '42501', null, 'site_admin cannot call wp_profit (42501)');

-- 4. Unbound caller fails closed.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select * from public.wp_profit('bb000000-0000-0000-0000-000000000252') $$,
  '42501', null, 'unbound caller fails closed (42501)');
reset role;

-- 5. Unknown WP still refused for an allowed role (P0001 — behaviour preserved).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111252"}';
select throws_ok(
  $$ select * from public.wp_profit('00000000-0000-0000-0000-000000000000') $$,
  'P0001', null, 'unknown WP still raises P0001 (body behaviour preserved)');
reset role;

select * from finish();
rollback;
