begin;
select plan(60);

-- ============================================================================
-- Spec 226 — Global work_categories library (ADR 0066 / S5, decision D4). Defect
-- C3: per-project free-form work-categories don't generalize. This adds a
-- firm-wide public.work_categories library (bilingual name_th/name_en, stable
-- code, optional masterformat_code), seeded from the reconciled BuildAll BOQ
-- (PRC-2026-004) work axis: 9 top categories W01–W09 + 43 subsections (flat
-- 2-level code grain — a subsection's parent is left(code,3); no self-FK). The
-- per-project project_categories gains a NULLABLE work_category_id reconcile FK
-- (per-project freedom + the locked one-category-per-WP rule preserved). The
-- material axis (catalog_categories) gains name_en for cross-language parity.
-- Posture follows ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO
-- direct write/delete grant, writes via null-safe SECURITY DEFINER RPCs. The
-- work-library RPCs are firm-wide role-gated (pm/super/director); the per-project
-- reconcile RPC additionally membership-gates (can_see_project).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333226', 'pm-mem@wc226.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666226', 'pm-nonmem@wc226.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444226', 'visitor@wc226.local',   '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333226';
update public.users set role='project_manager' where id='66666666-6666-6666-6666-666666666226';
-- the visitor user keeps the default 'visitor' role from the auth.users trigger.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc2226', 'PRC-TEST-WC-226', 'Work-category fixture project');
-- Enrol ONLY the member PM (33…); the non-member PM (66…) is deliberately left out.
insert into public.project_members (project_id, user_id, added_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccc2226',
   '33333333-3333-3333-3333-333333333226',
   '33333333-3333-3333-3333-333333333226');
-- A per-project category to reconcile, inserted as table owner with a KNOWN id so
-- the non-member-PM gate test can pass a valid id it cannot itself SELECT (RLS).
insert into public.project_categories (id, project_id, code, name, sort_order, is_active, created_by) values
  ('dddddddd-dddd-dddd-dddd-dddddddd2226',
   'cccccccc-cccc-cccc-cccc-cccccccc2226', 'RC', 'หมวดรีคอนไซล์', 1, true,
   '33333333-3333-3333-3333-333333333226');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure (work_categories) --------------------------------------------
select has_table('public', 'work_categories', 'work_categories table exists');
select has_column('public', 'work_categories', 'id', 'has id');
select has_column('public', 'work_categories', 'code', 'has code');
select has_column('public', 'work_categories', 'name_th', 'has name_th');
select has_column('public', 'work_categories', 'name_en', 'has name_en');
select has_column('public', 'work_categories', 'masterformat_code', 'has masterformat_code');
select has_column('public', 'work_categories', 'sort_order', 'has sort_order');
select has_column('public', 'work_categories', 'is_active', 'has is_active');
select has_column('public', 'work_categories', 'created_by', 'has created_by');
select has_column('public', 'work_categories', 'created_at', 'has created_at');
select has_column('public', 'work_categories', 'updated_at', 'has updated_at');
select ok(
  (select relrowsecurity from pg_class where oid='public.work_categories'::regclass),
  'RLS enabled on work_categories');
select ok(
  has_table_privilege('authenticated', 'public.work_categories', 'select'),
  'authenticated may SELECT work_categories');
select ok(
  not has_table_privilege('anon', 'public.work_categories', 'select'),
  'anon may NOT SELECT work_categories');
select ok(
  not has_table_privilege('authenticated', 'public.work_categories', 'delete'),
  'authenticated may NOT DELETE work_categories (deactivate-not-delete)');
select col_is_unique('public', 'work_categories', 'code', 'code is unique (stable key)');

-- B. Seed (reconciled BuildAll BOQ work axis: 9 top + 43 subs = 52) ----------
select is(
  (select count(*)::int from public.work_categories), 52, 'seeded 52 work-categories (9 top + 43 subs)');
select is(
  (select count(*)::int from public.work_categories where char_length(code)=3), 9,
  'seeded 9 top categories (W01–W09, 3-char code)');
select is(
  (select count(*)::int from public.work_categories where char_length(code)=5), 43,
  'seeded 43 subsections (5-char code)');
select is(
  (select name_th from public.work_categories where code='W02'), 'งานโครงสร้าง',
  'anchor: W02 name_th = งานโครงสร้าง');
select is(
  (select name_th from public.work_categories where code='W0201'), 'เสาเข็มตอก',
  'anchor: W0201 name_th = เสาเข็มตอก');
select is(
  (select name_en from public.work_categories where code='W02'), 'Structural Work',
  'anchor: W02 name_en = Structural Work (bilingual)');
select ok(
  (select name_en is not null and length(trim(name_en)) > 0
     from public.work_categories where code='W0201'),
  'anchor: W0201 carries a non-blank name_en (bilingual)');
select is(
  (select count(*)::int from public.work_categories s
     where char_length(s.code)=5
       and not exists (select 1 from public.work_categories p where p.code=left(s.code,3))),
  0, 'flat-grain consistency: every subsection prefix resolves to a top category');
select ok(
  (select bool_and(is_active) from public.work_categories), 'all seeded rows are active');

-- C. Reconcile FK on project_categories (nullable; never forced) -------------
select has_column('public', 'project_categories', 'work_category_id', 'project_categories has work_category_id');
select col_is_null('public', 'project_categories', 'work_category_id',
  'project_categories.work_category_id is NULLABLE (reconcile, never forced)');
select fk_ok('public', 'project_categories', 'work_category_id', 'public', 'work_categories', 'id');

-- D. Material-axis parity (catalog_categories gains name_en) ------------------
select has_column('public', 'catalog_categories', 'name_en', 'catalog_categories has name_en (parity)');
select col_is_null('public', 'catalog_categories', 'name_en',
  'catalog_categories.name_en is NULLABLE (additive parity)');

-- E. RPC posture — SECURITY DEFINER + anon revoked + authenticated execute ---
select is(
  (select prosecdef from pg_proc
     where oid='public.create_work_category(text,text,text,text,integer)'::regprocedure),
  true, 'create_work_category is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.create_work_category(text,text,text,text,integer)', 'execute'),
  'anon may NOT execute create_work_category');
select ok(
  has_function_privilege('authenticated',
    'public.create_work_category(text,text,text,text,integer)', 'execute'),
  'authenticated may execute create_work_category');

select is(
  (select prosecdef from pg_proc
     where oid='public.update_work_category(text,text,text,text,integer)'::regprocedure),
  true, 'update_work_category is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.update_work_category(text,text,text,text,integer)', 'execute'),
  'anon may NOT execute update_work_category');
select ok(
  has_function_privilege('authenticated',
    'public.update_work_category(text,text,text,text,integer)', 'execute'),
  'authenticated may execute update_work_category');

select is(
  (select prosecdef from pg_proc
     where oid='public.set_work_category_active(text,boolean)'::regprocedure),
  true, 'set_work_category_active is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.set_work_category_active(text,boolean)', 'execute'),
  'anon may NOT execute set_work_category_active');
select ok(
  has_function_privilege('authenticated',
    'public.set_work_category_active(text,boolean)', 'execute'),
  'authenticated may execute set_work_category_active');

select is(
  (select prosecdef from pg_proc
     where oid='public.set_project_category_work_category(uuid,uuid)'::regprocedure),
  true, 'set_project_category_work_category is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.set_project_category_work_category(uuid,uuid)', 'execute'),
  'anon may NOT execute set_project_category_work_category');
select ok(
  has_function_privilege('authenticated',
    'public.set_project_category_work_category(uuid,uuid)', 'execute'),
  'authenticated may execute set_project_category_work_category');

-- F. Behaviour as a back-office member PM ------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333226"}';

select lives_ok(
  $$ select public.create_work_category('WTEST', 'หมวดทดสอบ', 'Test Category', null::text, 50) $$,
  'create_work_category adds a new work-category');
select throws_ok(
  $$ select public.create_work_category('WTEST', 'ซ้ำ', null::text, null::text, 0) $$,
  '23505', null, 'a duplicate code is rejected (23505)');
select throws_ok(
  $$ select public.create_work_category('WTEST2', '   ', null::text, null::text, 0) $$,
  '22023', null, 'a blank name_th is rejected (22023)');
select throws_ok(
  $$ select public.create_work_category('   ', 'ชื่อ', null::text, null::text, 0) $$,
  '22023', null, 'a blank code is rejected (22023)');
select lives_ok(
  $$ select public.update_work_category('WTEST', 'หมวดแก้ไข', 'Edited', null::text, 5) $$,
  'update_work_category renames the work-category');
select is(
  (select name_th from public.work_categories where code='WTEST'), 'หมวดแก้ไข',
  'the update applied the new name_th');
select throws_ok(
  $$ select public.update_work_category('NOPE', 'x', null::text, null::text, 0) $$,
  '22023', null, 'updating an unknown code is rejected (22023)');
select lives_ok(
  $$ select public.set_work_category_active('WTEST', false) $$,
  'set_work_category_active deactivates the work-category');
select is(
  (select is_active from public.work_categories where code='WTEST'), false,
  'the work-category is now inactive (deactivate-not-delete)');

-- Reconcile the (owner-seeded, known-id) project category RC to a global work-cat.
select lives_ok(
  $$ select public.set_project_category_work_category(
       'dddddddd-dddd-dddd-dddd-dddddddd2226'::uuid,
       (select id from public.work_categories where code='W02')) $$,
  'member PM reconciles a project category to a global work-category');
select is(
  (select work_category_id from public.project_categories
     where id='dddddddd-dddd-dddd-dddd-dddddddd2226'),
  (select id from public.work_categories where code='W02'),
  'the reconcile FK now points at W02');
select lives_ok(
  $$ select public.set_project_category_work_category(
       'dddddddd-dddd-dddd-dddd-dddddddd2226'::uuid, null) $$,
  'passing null un-reconciles (per-project freedom preserved)');
select is(
  (select work_category_id from public.project_categories
     where id='dddddddd-dddd-dddd-dddd-dddddddd2226'),
  null, 'the reconcile FK is back to NULL');
select throws_ok(
  $$ select public.set_project_category_work_category(
       '00000000-0000-0000-0000-000000000099'::uuid,
       (select id from public.work_categories where code='W02')) $$,
  '22023', null, 'an unknown project category is rejected (22023)');
select throws_ok(
  $$ select public.set_project_category_work_category(
       'dddddddd-dddd-dddd-dddd-dddddddd2226'::uuid,
       '00000000-0000-0000-0000-000000000098'::uuid) $$,
  '22023', null, 'an unknown work-category id is rejected (22023)');

-- G. Role + membership gates -------------------------------------------------
-- null/unbound role → 42501 (null-safe gate).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555226"}';
select throws_ok(
  $$ select public.create_work_category('DENYNULL', 'x', null::text, null::text, 0) $$,
  '42501', null, 'a null/unbound role cannot create a work-category (null-safe gate)');
-- visitor → 42501 (role gate).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444226"}';
select throws_ok(
  $$ select public.create_work_category('DENYVIS', 'x', null::text, null::text, 0) $$,
  '42501', null, 'a disallowed role (visitor) cannot create a work-category');
-- non-member PM reconcile → 42501 (per-project membership gate).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666226"}';
select throws_ok(
  $$ select public.set_project_category_work_category(
       'dddddddd-dddd-dddd-dddd-dddddddd2226'::uuid,
       (select id from public.work_categories where code='W02')) $$,
  '42501', null, 'a non-member PM cannot reconcile an unseen project category (membership gate)');

reset role;
select * from finish();
rollback;
