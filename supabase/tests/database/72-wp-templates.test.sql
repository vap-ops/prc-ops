begin;
select plan(11);

-- ============================================================================
-- Spec 142 U5 — WP templates by project_type.
--   wp_templates (reference data: project_type, code, name, description,
--     sort_order) — read-only to authenticated; seeded by migration.
--   apply_wp_template(p_project_id) returns integer — SECURITY DEFINER, PM/super;
--     inserts the matching-type templates into the project's work_packages
--     (on conflict do nothing → idempotent). Returns rows inserted.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@tpl-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@tpl-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@tpl-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@tpl-test.local', '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111111111';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222222';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';
-- '4444…' stays visitor.

-- NB: a typed project (new_building). NT: a project with no type.
insert into public.projects (id, code, name, project_type) values
  ('46464646-4646-4646-4646-464646464646', 'PRC-TPL-NB', 'อาคารใหม่ทดสอบ', 'new_building'),
  ('77777777-0000-0000-0000-000000000077', 'PRC-TPL-NT', 'ไม่ระบุประเภท', null);

insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TPL-NB', 'PRC-TPL-NT')
     and u.id in (select au.id from auth.users au where au.email like '%@tpl-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select has_table('public', 'wp_templates', 'wp_templates table exists');
select is(
  (select relrowsecurity from pg_class where oid='public.wp_templates'::regclass),
  true, 'RLS enabled on wp_templates');
select ok(
  to_regprocedure('public.apply_wp_template(uuid)') is not null,
  'apply_wp_template(uuid) exists');
select is(
  (select prosecdef from pg_proc where oid='public.apply_wp_template(uuid)'::regprocedure),
  true, 'apply_wp_template is SECURITY DEFINER');

set local role authenticated;

-- A.5 Seed present + readable by staff: new_building has at least one template.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select cmp_ok(
  (select count(*)::int from public.wp_templates where project_type='new_building'),
  '>', 0, 'new_building has seeded templates, readable by staff');

-- B. apply behaviour (PM).
select is(
  (select public.apply_wp_template('46464646-4646-4646-4646-464646464646')),
  (select count(*)::int from public.wp_templates where project_type='new_building'),
  'apply inserts every new_building template');
select is(
  (select count(*)::int from public.work_packages
     where project_id='46464646-4646-4646-4646-464646464646'),
  (select count(*)::int from public.wp_templates where project_type='new_building'),
  'the template work packages landed on the project');
select is(
  (select public.apply_wp_template('46464646-4646-4646-4646-464646464646')),
  0, 're-apply is idempotent (codes already present)');

-- B.4 Project with no type → 0 (nothing to apply, no error).
select is(
  (select public.apply_wp_template('77777777-0000-0000-0000-000000000077')),
  0, 'a project with no project_type applies 0 templates');

-- C. Role gate.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select public.apply_wp_template('46464646-4646-4646-4646-464646464646') $$,
  '42501', null, 'visitor apply_wp_template is denied (42501)');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ select public.apply_wp_template('46464646-4646-4646-4646-464646464646') $$,
  '42501', null, 'site_admin apply_wp_template is denied (42501)');

reset role;

select * from finish();
rollback;
