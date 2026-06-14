begin;
select plan(9);

-- ============================================================================
-- Spec 91 follow-up — work_packages.priority + set_work_package_priority RPC.
-- Manual PM/super urgency flag. New WPs default 'normal'; SA/visitor are denied
-- the setter (42501); PM/super set it. Enum order normal<urgent<critical.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-2222222246ff', 'sa@wpp-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333346ff', 'pm@wpp-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444446ff', 'visitor@wpp-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222246ff';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333346ff';
-- 4444…46ff keeps default 'visitor'.

insert into public.projects (id, code, name) values
  ('c0000046-46ff-46ff-46ff-46ff46ff46ff', 'PRC-TEST-WPP', 'WP priority fixture');
-- WP inserted WITHOUT priority — exercises the DEFAULT.
insert into public.work_packages (id, project_id, code, name) values
  ('a0000046-46ff-46ff-46ff-46ff46ff46ff',
   'c0000046-46ff-46ff-46ff-46ff46ff46ff', 'WPP-1', 'priority fixture WP');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog + default + ordering.
select has_column('public', 'work_packages', 'priority', 'work_packages.priority exists');
select col_not_null('public', 'work_packages', 'priority', 'priority is NOT NULL');
select has_function('public', 'set_work_package_priority', 'set_work_package_priority RPC exists');
select ok(
  'normal'::public.work_package_priority < 'urgent'::public.work_package_priority
  and 'urgent'::public.work_package_priority < 'critical'::public.work_package_priority,
  'enum order normal < urgent < critical');
select is(
  (select priority::text from public.work_packages
     where id = 'a0000046-46ff-46ff-46ff-46ff46ff46ff'),
  'normal', 'a new WP defaults to priority = normal');

-- B. Role-sim — the RPC enforces PM/super only.
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222246ff"}';
select throws_ok(
  $$ select public.set_work_package_priority('a0000046-46ff-46ff-46ff-46ff46ff46ff', 'urgent') $$,
  '42501', null, 'site_admin cannot call set_work_package_priority');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444446ff"}';
select throws_ok(
  $$ select public.set_work_package_priority('a0000046-46ff-46ff-46ff-46ff46ff46ff', 'urgent') $$,
  '42501', null, 'visitor cannot call set_work_package_priority');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333346ff"}';
select lives_ok(
  $$ select public.set_work_package_priority('a0000046-46ff-46ff-46ff-46ff46ff46ff', 'critical') $$,
  'project_manager sets priority');

reset role;

-- C. Outcome.
select is(
  (select priority::text from public.work_packages
     where id = 'a0000046-46ff-46ff-46ff-46ff46ff46ff'),
  'critical', 'the PM call set priority = critical');

select * from finish();
rollback;
