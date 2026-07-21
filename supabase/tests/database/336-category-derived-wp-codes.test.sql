begin;
select plan(20);

-- ============================================================================
-- Spec 336 — category-derived งานย่อย codes (W05-01), retiring the WP- prefix.
--   create_work_package gains a trailing p_category_id so the new row HOLDS the
--   category its code claims; suggest_work_package_code returns the next free
--   <category>-NN. Numbering is per PROJECT + CATEGORY because (project_id, code)
--   is unique — two งาน sharing a category would collide under per-งาน numbering.
--   Forward-only: legacy WP-* codes are neither recoded nor counted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Catalog: the widened signature, still one overload, grants on both.
-- ---------------------------------------------------------------------------
select has_function('public', 'create_work_package',
  array['uuid','text','text','text','uuid','uuid'],
  'create_work_package(uuid, text, text, text, uuid, uuid) exists');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_work_package'),
  1, 'exactly one create_work_package overload (5-arg dropped)');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_work_package'),
  true, 'create_work_package is still SECURITY DEFINER');

select is(
  has_function_privilege('anon',
    'public.create_work_package(uuid, text, text, text, uuid, uuid)', 'execute'),
  false, 'anon cannot execute create_work_package');

select is(
  has_function_privilege('authenticated',
    'public.create_work_package(uuid, text, text, text, uuid, uuid)', 'execute'),
  true, 'authenticated can execute create_work_package');

select has_function('public', 'suggest_work_package_code',
  array['uuid','uuid'], 'suggest_work_package_code(uuid, uuid) exists');

-- INVOKER on purpose: it only reads, so the caller's RLS is the right gate.
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'suggest_work_package_code'),
  false, 'suggest_work_package_code is SECURITY INVOKER (RLS applies)');

select is(
  has_function_privilege('anon',
    'public.suggest_work_package_code(uuid, uuid)', 'execute'),
  false, 'anon cannot execute suggest_work_package_code');

select is(
  has_function_privilege('authenticated',
    'public.suggest_work_package_code(uuid, uuid)', 'execute'),
  true, 'authenticated can execute suggest_work_package_code');

-- ---------------------------------------------------------------------------
-- Fixtures: one manager, two projects, categories in each, and a งาน in P1
-- carrying legacy WP- children (which must NOT influence the numbering).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110336', 'super@cat-code.local', '{}'::jsonb);
update public.users set role='super_admin' where id='11111111-1111-1111-1111-111111110336';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'PRC-336-P1', 'โครงการหลัก',
   '11111111-1111-1111-1111-111111110336'),
  ('a2a20336-0336-0336-0336-a2a2a2a20336', 'PRC-336-P2', 'โครงการอื่น',
   '11111111-1111-1111-1111-111111110336');

insert into public.project_categories (id, project_id, code, name, sort_order, created_by) values
  ('c0050336-0336-0336-0336-c005c0050336', 'a1a10336-0336-0336-0336-a1a1a1a10336',
   'W05', 'งานระบบไฟฟ้า & สื่อสาร', 5, '11111111-1111-1111-1111-111111110336'),
  ('c0090336-0336-0336-0336-c009c0090336', 'a1a10336-0336-0336-0336-a1a1a1a10336',
   'W09', 'งานที่ยังไม่เคยใช้', 9, '11111111-1111-1111-1111-111111110336'),
  ('c0f10336-0336-0336-0336-c0f1c0f10336', 'a2a20336-0336-0336-0336-a2a2a2a20336',
   'W05', 'หมวดของโครงการอื่น', 5, '11111111-1111-1111-1111-111111110336');

insert into public.work_packages (id, project_id, code, name, is_group, category_id) values
  ('91910336-0336-0336-0336-919191910336', 'a1a10336-0336-0336-0336-a1a1a1a10336',
   'WP-01', 'งานไฟฟ้า', true, 'c0050336-0336-0336-0336-c005c0050336');

-- Two already-migrated children + two legacy ones under the same งาน.
insert into public.work_packages (project_id, code, name, parent_id, category_id) values
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'W05-01', 'เดินท่อร้อยสาย',
   '91910336-0336-0336-0336-919191910336', 'c0050336-0336-0336-0336-c005c0050336'),
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'W05-02', 'ติดตั้งตู้ MDB',
   '91910336-0336-0336-0336-919191910336', 'c0050336-0336-0336-0336-c005c0050336'),
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'WP-01-07', 'งานเก่าเลขเจ็ด',
   '91910336-0336-0336-0336-919191910336', 'c0050336-0336-0336-0336-c005c0050336'),
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'WP-01-99', 'งานเก่าเลขเก้าสิบเก้า',
   '91910336-0336-0336-0336-919191910336', 'c0050336-0336-0336-0336-c005c0050336');

-- The runner rewrites assertion selects into _tap_buf; the role-switched
-- sections below need these grants (same as 69/270).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---------------------------------------------------------------------------
-- B. The suggester.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110336"}';

select is(
  public.suggest_work_package_code(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'c0050336-0336-0336-0336-c005c0050336'::uuid),
  'W05-03',
  'next free number after W05-01 and W05-02');

select is(
  public.suggest_work_package_code(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'c0090336-0336-0336-0336-c009c0090336'::uuid),
  'W09-01',
  'an unused category starts at 01');

-- Numbering aggregates across งาน sharing a category — the stated reason it is
-- per project + category. A SECOND งาน in W05 taking W05-03 must push the next
-- suggestion to 04, not restart at 01 (which would 23505 on the unique code).
reset role;
insert into public.work_packages (id, project_id, code, name, is_group, category_id) values
  ('92920336-0336-0336-0336-929292920336', 'a1a10336-0336-0336-0336-a1a1a1a10336',
   'WP-02', 'งานไฟฟ้าอีกกลุ่ม', true, 'c0050336-0336-0336-0336-c005c0050336');
insert into public.work_packages (project_id, code, name, parent_id, category_id) values
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'W05-03', 'งานใต้กลุ่มที่สอง',
   '92920336-0336-0336-0336-929292920336', 'c0050336-0336-0336-0336-c005c0050336');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110336"}';

select is(
  public.suggest_work_package_code(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'c0050336-0336-0336-0336-c005c0050336'::uuid),
  'W05-04',
  'numbering aggregates across งาน sharing the category');

-- Past 99 the padding must not SHORTEN the number: lpad('100',2,'0') is '10',
-- which would hand out a colliding code forever. This is the assertion that
-- catches it (mig 075823 shipped that bug; 075825 fixed it).
reset role;
-- Needs a parent: the U6 forward guard rejects a parentless งานย่อย once the
-- project has งาน rows. The suggester keys on project + category, not parent.
insert into public.work_packages (project_id, code, name, parent_id, category_id) values
  ('a1a10336-0336-0336-0336-a1a1a1a10336', 'W09-99', 'งานเลขเก้าสิบเก้า',
   '91910336-0336-0336-0336-919191910336', 'c0090336-0336-0336-0336-c009c0090336');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110336"}';

select is(
  public.suggest_work_package_code(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'c0090336-0336-0336-0336-c009c0090336'::uuid),
  'W09-100',
  'the series rolls past 99 without truncating the number');

-- Same code (W05) but the category belongs to the other project.
select is(
  public.suggest_work_package_code(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'c0f10336-0336-0336-0336-c0f1c0f10336'::uuid),
  null,
  'a category from another project suggests nothing');

-- ---------------------------------------------------------------------------
-- C. Creating WITH the category.
-- ---------------------------------------------------------------------------
-- The runner re-executes assertion selects into _tap_buf, so a create must sit
-- in its own lives_ok statement and be read back by code (the 270 pattern) —
-- calling it inside `is(...)` fires it twice and 23505s on the unique code.
select lives_ok($$
  select public.create_work_package(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'W05-04', 'งานย่อยใหม่', null,
    '91910336-0336-0336-0336-919191910336'::uuid,
    'c0050336-0336-0336-0336-c005c0050336'::uuid) $$,
  'create with a category succeeds');

select is(
  (select w.category_id from public.work_packages w
    where w.project_id = 'a1a10336-0336-0336-0336-a1a1a1a10336' and w.code = 'W05-04'),
  'c0050336-0336-0336-0336-c005c0050336'::uuid,
  'the new row is created WITH the category its code claims');

select throws_ok($$
  select public.create_work_package(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'W05-05', 'งานย่อยผิดหมวด', null,
    '91910336-0336-0336-0336-919191910336'::uuid,
    'c0f10336-0336-0336-0336-c0f1c0f10336'::uuid) $$,
  '22023', null, 'a category from another project is rejected');

-- Parity with set_work_package_category (mig 003400), which refuses an inactive
-- category: without this arm the create path could bind what the designated
-- writer would not.
reset role;
update public.project_categories set is_active = false
 where id = 'c0090336-0336-0336-0336-c009c0090336';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110336"}';

select throws_ok($$
  select public.create_work_package(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'W09-01', 'งานย่อยหมวดปิด', null,
    '91910336-0336-0336-0336-919191910336'::uuid,
    'c0090336-0336-0336-0336-c009c0090336'::uuid) $$,
  '22023', null, 'a deactivated category is rejected (parity with set_work_package_category)');

select lives_ok($$
  select public.create_work_package(
    'a1a10336-0336-0336-0336-a1a1a1a10336'::uuid,
    'W05-06', 'งานย่อยไม่ระบุหมวด', null,
    '91910336-0336-0336-0336-919191910336'::uuid) $$,
  'omitting the category still works (back-compat with the 5-arg call sites)');

select is(
  (select w.category_id from public.work_packages w
    where w.project_id = 'a1a10336-0336-0336-0336-a1a1a1a10336' and w.code = 'W05-06'),
  null::uuid,
  'omitted category lands null rather than being invented');

select * from finish();
rollback;
