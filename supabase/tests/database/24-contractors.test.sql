begin;
select plan(38);

-- ============================================================================
-- Spec 31 / ADR 0033 (+ staff-write amendment) — contractors master,
-- work_packages.contractor_id, and the set_work_package_contractor RPC.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-22222222dddd', 'sa@ctr-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333dddd', 'pm@ctr-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-44444444dddd', 'visitor@ctr-test.local', '{}'::jsonb),
  -- Spec 172 Phase B: procurement now manages contractors.
  ('66666666-6666-6666-6666-66666666dddd', 'proc@ctr-test.local',    '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222dddd';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333dddd';
update public.users set role = 'procurement'      where id = '66666666-6666-6666-6666-66666666dddd';
-- 4444…dddd keeps default 'visitor'.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc2222', 'PRC-TEST-CTR', 'CTR fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee2222',
   'cccccccc-cccc-cccc-cccc-cccccccc2222', 'WP-CTR-1', 'CTR fixture WP'),
  -- Spec 172 Phase B: a 2nd WP so procurement's assign test doesn't disturb the
  -- section-D outcome assertion on the first WP.
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee2223',
   'cccccccc-cccc-cccc-cccc-cccccccc2222', 'WP-CTR-2', 'CTR fixture WP 2');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- B. Catalog.
select has_table('public', 'contractors', 'contractors exists');
select has_column('public', 'work_packages', 'contractor_id', 'work_packages.contractor_id exists');
select is((select relrowsecurity from pg_class where oid = 'public.contractors'::regclass),
  true, 'RLS enabled on contractors');
select policies_are('public', 'contractors',
  array['contractors readable by privileged roles',
        'contractors insert by staff',
        'contractors update by staff',
        'contractors readable by bound contractor'],
  'the contractor policies: three staff (read/insert/update) + the spec-130 external own-row read — NO delete policy');
select is(has_table_privilege('authenticated', 'public.contractors', 'DELETE'),
  false, 'authenticated has NO DELETE on contractors');
select throws_ok(
  $$ insert into public.contractors (name, created_by)
     values ('   ', '33333333-3333-3333-3333-33333333dddd') $$,
  '23514', null, 'blank contractor name violates contractors_name_nonblank');
select has_function('public', 'set_work_package_contractor',
  'assignment RPC exists (SECURITY DEFINER, contractor_id only)');

-- Spec 81 — masters note column (rides the existing UPDATE policy/grant).
select has_column('public', 'contractors', 'note', 'spec 81: contractors.note exists');
select col_is_null('public', 'contractors', 'note', 'spec 81: contractors.note is nullable');
select col_type_is('public', 'contractors', 'note', 'text', 'spec 81: contractors.note is text');
select throws_ok(
  $$ insert into public.contractors (name, note, created_by)
     values ('ยาวเกิน', repeat('x', 2001), '33333333-3333-3333-3333-33333333dddd') $$,
  '23514', null, 'spec 81: note > 2000 violates contractors_note_len');
select is(has_column_privilege('authenticated', 'public.contractors', 'note', 'INSERT'),
  true, 'spec 81: authenticated may INSERT contractors.note');
select is(has_column_privilege('authenticated', 'public.contractors', 'note', 'UPDATE'),
  true, 'spec 81: authenticated may UPDATE contractors.note');

-- Spec 83 — contractor taxonomy (category/subtype/status) + enrichment + DC backfill.
select has_column('public', 'contractors', 'contractor_category', 'spec 83: contractor_category exists');
select has_column('public', 'contractors', 'contractor_subtype', 'spec 83: contractor_subtype exists');
select has_column('public', 'contractors', 'status', 'spec 83: status exists');
select has_column('public', 'contractors', 'contact_person', 'spec 83: contact_person exists');
select has_column('public', 'contractors', 'tax_id', 'spec 83: tax_id exists');
-- Defaults on a bare insert.
select lives_ok(
  $$ insert into public.contractors (id, name, created_by)
     values ('d4000000-dddd-dddd-dddd-dddddddd2222', 'DefaultsCo',
             '33333333-3333-3333-3333-33333333dddd') $$,
  'spec 83: contractor inserts with taxonomy defaults');
select is((select contractor_category::text from public.contractors
             where id = 'd4000000-dddd-dddd-dddd-dddddddd2222'),
  'contractor', 'spec 83: contractor_category defaults to contractor');
select is((select status::text from public.contractors
             where id = 'd4000000-dddd-dddd-dddd-dddddddd2222'),
  'active', 'spec 83: status defaults to active');
-- subtype↔category CHECK rejects a mismatch.
select throws_ok(
  $$ insert into public.contractors (name, created_by, contractor_category, contractor_subtype)
     values ('Mismatch', '33333333-3333-3333-3333-33333333dddd', 'contractor', 'dc_company') $$,
  '23514', null, 'spec 83: subtype must match category (contractor+dc_company rejected)');
-- length CHECK rejects.
select throws_ok(
  $$ insert into public.contractors (name, created_by, tax_id)
     values ('LongTax', '33333333-3333-3333-3333-33333333dddd', repeat('9', 51)) $$,
  '23514', null, 'spec 83: tax_id > 50 violates the length CHECK');
-- Column grants on the new columns.
select is(has_column_privilege('authenticated', 'public.contractors', 'contractor_category', 'INSERT'),
  true, 'spec 83: authenticated may INSERT contractor_category');
select is(has_column_privilege('authenticated', 'public.contractors', 'status', 'UPDATE'),
  true, 'spec 83: authenticated may UPDATE status');
-- DC-wins backfill logic: a contractor referenced by a dc worker reclassifies to dc.
insert into public.contractors (id, name, created_by)
  values ('d5000000-dddd-dddd-dddd-dddddddd2222', 'BackfillCo',
          '33333333-3333-3333-3333-33333333dddd');
insert into public.workers (id, name, worker_type, contractor_id, day_rate, created_by)
  values ('77770000-dddd-dddd-dddd-dddddddd2222', 'dc-person', 'dc',
          'd5000000-dddd-dddd-dddd-dddddddd2222', 500,
          '33333333-3333-3333-3333-33333333dddd');
update public.contractors c set contractor_category = 'dc'
 where exists (select 1 from public.workers w
                where w.contractor_id = c.id and w.worker_type = 'dc');
select is((select contractor_category::text from public.contractors
             where id = 'd5000000-dddd-dddd-dddd-dddddddd2222'),
  'dc', 'spec 83: DC-wins backfill reclassifies a dc-worker contractor');

-- C. Role-sim.
set local role authenticated;

-- C.1 PM creates a contractor.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333dddd"}';
select lives_ok(
  $$ insert into public.contractors (id, name, phone, created_by)
     values ('d1000000-dddd-dddd-dddd-dddddddd2222', 'ทีมช่างสมชาย', '081-000-0000',
             '33333333-3333-3333-3333-33333333dddd') $$,
  'PM creates a contractor');

-- C.1b PM sets a note on its contractor (spec 81 — masters note, no RPC needed).
select lives_ok(
  $$ update public.contractors set note = 'ทีมหลัก งานโครงสร้าง'
     where id = 'd1000000-dddd-dddd-dddd-dddddddd2222' $$,
  'spec 81: PM updates a contractor note via the existing UPDATE policy');

-- C.2 SA creates a contractor (amendment: field staff manage crews too).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222dddd"}';
select lives_ok(
  $$ insert into public.contractors (id, name, created_by)
     values ('d2000000-dddd-dddd-dddd-dddddddd2222', 'ทีมช่าง SA',
             '22222222-2222-2222-2222-22222222dddd') $$,
  'SA creates a contractor (staff-write amendment)');

-- C.3 SA assigns via the RPC (no direct WP UPDATE path exists for SA).
select lives_ok(
  $$ select public.set_work_package_contractor(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222',
       'd2000000-dddd-dddd-dddd-dddddddd2222') $$,
  'SA assigns a contractor via the RPC');

-- C.4 SA direct UPDATE on work_packages stays filtered (RLS unchanged).
select lives_ok(
  $$ update public.work_packages set contractor_id = null
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222' $$,
  'SA direct WP UPDATE statement runs (RLS filters to 0 rows)');

-- C.5 Visitor is rejected by the RPC role check.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-44444444dddd"}';
select throws_ok(
  $$ select public.set_work_package_contractor(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222', null) $$,
  '42501', null, 'visitor cannot call the assignment RPC');

-- Spec 172 Phase B — procurement manages contractors (full ownership).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-66666666dddd"}';
-- C.6 procurement creates a contractor (INSERT policy now admits it; created_by self).
select lives_ok(
  $$ insert into public.contractors (id, name, created_by)
     values ('d6000000-dddd-dddd-dddd-dddddddd2222', 'ทีมช่าง จัดซื้อ',
             '66666666-6666-6666-6666-66666666dddd') $$,
  'spec 172: procurement creates a contractor');
-- C.7 procurement updates a contractor (UPDATE policy now admits it).
select lives_ok(
  $$ update public.contractors set note = 'ดูแลโดยจัดซื้อ'
     where id = 'd6000000-dddd-dddd-dddd-dddddddd2222' $$,
  'spec 172: procurement updates a contractor');
-- C.8 procurement assigns a contractor to a WP via the RPC (2nd WP, leaves the
--     section-D outcome on WP-1 intact).
select lives_ok(
  $$ select public.set_work_package_contractor(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee2223',
       'd6000000-dddd-dddd-dddd-dddddddd2222') $$,
  'spec 172: procurement assigns a contractor to a WP');

reset role;

-- D. Outcomes.
select is(
  (select contractor_id from public.work_packages
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222'),
  'd2000000-dddd-dddd-dddd-dddddddd2222'::uuid,
  'RPC assignment landed; SA direct UPDATE was filtered (still assigned)');
select is(
  (select created_by from public.contractors
     where id = 'd2000000-dddd-dddd-dddd-dddddddd2222'),
  '22222222-2222-2222-2222-22222222dddd'::uuid,
  'created_by pinned to the creating SA');
select is(
  (select note from public.contractors
     where id = 'd1000000-dddd-dddd-dddd-dddddddd2222'),
  'ทีมหลัก งานโครงสร้าง',
  'spec 81: PM contractor-note update landed');

select * from finish();
rollback;
