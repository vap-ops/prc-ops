begin;
select plan(16);

-- ============================================================================
-- Spec 220 / ADR 0050 (G63) — set_user_role: super_admin changes a user's role
-- in-app, replacing out-of-band SQL. SECURITY DEFINER, super_admin-only (on the
-- authenticated session), audited (one 'role_change' row), guard-railed:
--   - last-super_admin lockout (cannot leave zero super_admins),
--   - self-demotion (a super cannot change their own role).
-- Guard order is last-super BEFORE self so both are reachable/distinguishable:
-- a lone super demoting self trips last-super; a super demoting self while
-- another super exists trips self.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110220', 'superA@role.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220220', 'superB@role.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330220', 'pm@role.local',     '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880220', 'vis1@role.local',   '{}'::jsonb),
  ('99999999-9999-9999-9999-999999990220', 'vis2@role.local',   '{}'::jsonb);
update public.users set role = 'super_admin'     where id in
  ('11111111-1111-1111-1111-111111110220', '22222222-2222-2222-2222-222222220220');
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333330220';
-- 8888…/9999… stay visitor.
-- The live DB has real super_admins; demote everyone OUTSIDE this fixture so the
-- last-super_admin count is deterministic in this (rolled-back) txn — otherwise
-- the count never reaches 1 and the lockout guard can't be exercised.
update public.users set role = 'site_admin'
  where role = 'super_admin'
    and id not in ('11111111-1111-1111-1111-111111110220',
                   '22222222-2222-2222-2222-222222220220');

-- A. Catalog.
select has_function('public', 'set_user_role', 'set_user_role RPC exists');
select is((select prosecdef from pg_proc
            where oid = 'public.set_user_role(uuid,public.user_role)'::regprocedure),
  true, 'set_user_role is SECURITY DEFINER');

-- B. Grants — owner-privileged but anon-locked (ADR 0050 / pgTAP 229 posture).
select function_privs_are('public', 'set_user_role', array['uuid', 'public.user_role'],
  'anon', array[]::text[], 'anon cannot execute set_user_role');
select function_privs_are('public', 'set_user_role', array['uuid', 'public.user_role'],
  'authenticated', array['EXECUTE'], 'authenticated can execute set_user_role');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- C. super_admin promotes a visitor (both supers still present).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110220"}';
select lives_ok(
  $$ select public.set_user_role('88888888-8888-8888-8888-888888880220', 'project_manager') $$,
  'super_admin promotes a visitor to project_manager');
select is(
  (select role::text from public.users where id = '88888888-8888-8888-8888-888888880220'),
  'project_manager', 'the visitor is now project_manager');
select is(
  (select count(*)::int from public.audit_log
     where action = 'role_change' and target_id = '88888888-8888-8888-8888-888888880220'),
  1, 'exactly one role_change audit row for the promotion');

-- D. Gate — non-super and anon are refused.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330220"}';
select throws_ok(
  $$ select public.set_user_role('99999999-9999-9999-9999-999999990220', 'procurement') $$,
  '42501', null, 'project_manager cannot call set_user_role');
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.set_user_role('99999999-9999-9999-9999-999999990220', 'procurement') $$,
  '42501', null, 'a null/anon session cannot call set_user_role');

-- E. Self-demotion guard — superA tries to change own role while superB exists.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110220"}';
select throws_ok(
  $$ select public.set_user_role('11111111-1111-1111-1111-111111110220', 'project_manager') $$,
  '22023', 'set_user_role: cannot change your own role',
  'a super_admin cannot change their own role (another super present)');

-- F. Demoting another super_admin succeeds while one remains.
select lives_ok(
  $$ select public.set_user_role('22222222-2222-2222-2222-222222220220', 'project_manager') $$,
  'super_admin demotes another super_admin (one remains)');
select is(
  (select role::text from public.users where id = '22222222-2222-2222-2222-222222220220'),
  'project_manager', 'superB is now project_manager');

-- G. Last-super_admin lockout — superA is now the only super; self-demote trips it.
select throws_ok(
  $$ select public.set_user_role('11111111-1111-1111-1111-111111110220', 'project_manager') $$,
  '22023', 'set_user_role: cannot remove the last super_admin',
  'cannot demote the last super_admin');

-- H. Unknown target.
select throws_ok(
  $$ select public.set_user_role('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0220', 'procurement') $$,
  '22023', null, 'an unknown target user is rejected');

-- I. No-op — setting the role it already has writes no audit row, no error.
select lives_ok(
  $$ select public.set_user_role('99999999-9999-9999-9999-999999990220', 'visitor') $$,
  'setting the same role is a no-op (no error)');
select is(
  (select count(*)::int from public.audit_log
     where action = 'role_change' and target_id = '99999999-9999-9999-9999-999999990220'),
  0, 'a no-op writes no audit row');

reset role;
select * from finish();
rollback;
