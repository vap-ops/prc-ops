-- Spec 331 U1 — company document type registry: two curated tables (super-only
-- DEFINER RPCs, house work_categories pattern), company_documents.type_id/label,
-- and the BEFORE INSERT trigger enforcing type-required · singleton · no-morph ·
-- label discipline · expiry discipline. Runner form: begin → plan → rollback.
--
-- Data asserts are scoped to THIS file's fixture ids (spec 310 lesson, recurred
-- 2026-07-19 in #652): never a bare count(*) over a table real uploads touch.
begin;
select plan(30);

-- ── registry structure ───────────────────────────────────────
select has_table('public', 'company_document_categories', 'categories table exists');
select has_table('public', 'company_document_types', 'types table exists');
select col_is_unique('public', 'company_document_categories', 'code', 'category code unique');
select col_is_unique('public', 'company_document_types', 'code', 'type code unique');
select has_column('public', 'company_document_types', 'is_singleton', 'is_singleton flag');
select has_column('public', 'company_document_types', 'is_required', 'is_required flag');
select has_column('public', 'company_document_types', 'requires_expiry', 'requires_expiry flag');
select has_column('public', 'company_documents', 'type_id', 'documents carry type_id');
select has_column('public', 'company_documents', 'label', 'documents carry label');

-- ── seed ─────────────────────────────────────────────────────
select is(
  (select count(*) from public.company_document_categories
    where code in ('REG', 'TAX', 'SSO', 'FIN', 'LIC', 'INS', 'PRF')),
  7::bigint, 'seven categories seeded');
select is(
  (select count(*) from public.company_document_types t
    join public.company_document_categories c on c.id = t.category_id),
  31::bigint, 'thirty-one types seeded, all category-bound');
select ok(
  (select is_singleton and is_required from public.company_document_types
    where code = 'TAX_PP20'),
  'ภ.พ.20 seeded singleton + required');
select ok(
  (select not is_singleton and requires_expiry from public.company_document_types
    where code = 'INS_CAR'),
  'CAR policy seeded multi + expiry-required');

-- ── registry read posture (house: any authenticated) ─────────
select is(
  (select count(*) from pg_policy
    where polrelid = 'public.company_document_types'::regclass and polcmd = 'r'),
  1::bigint, 'types table has exactly one SELECT policy');
select is(
  (select count(*) from pg_policy
    where polrelid = 'public.company_document_types'::regclass and polcmd <> 'r'),
  0::bigint, 'no write policies — RPCs are the only write path');

-- ── fixtures ─────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4331-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spec331-acc@test.local'),
  ('00000000-0000-4331-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spec331-super@test.local');
update public.users set role = 'accounting'
  where id = '00000000-0000-4331-a000-000000000001';
update public.users set role = 'super_admin'
  where id = '00000000-0000-4331-a000-000000000002';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4331-a000-000000000001"}';

-- ── rule 1: content row must carry a type ────────────────────
select throws_ok($$
  insert into public.company_documents (title, storage_path, created_by)
  values ('no type', 'x331/a.pdf', '00000000-0000-4331-a000-000000000001')
$$, '23514', null, 'content row without type_id rejected');

-- singleton type, first document → allowed
select lives_ok($$
  insert into public.company_documents (id, type_id, title, storage_path, created_by)
  select '00000000-0000-4331-d000-000000000001', t.id, t.name_th,
         '00000000-0000-4331-d000-000000000001/pp20.pdf',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'TAX_PP20'
$$, 'first ภ.พ.20 accepted');

-- ── rule 2: singleton guard ──────────────────────────────────
select throws_ok($$
  insert into public.company_documents (type_id, title, storage_path, created_by)
  select t.id, t.name_th, 'x331/pp20-dup.pdf', '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'TAX_PP20'
$$, 'P0001', null, 'second live ภ.พ.20 rejected (the redundancy fix)');

-- a VERSION of the same chain is exempt
select lives_ok($$
  insert into public.company_documents (id, type_id, title, storage_path, superseded_by, created_by)
  select '00000000-0000-4331-d000-000000000002', t.id, t.name_th,
         '00000000-0000-4331-d000-000000000002/pp20-v2.pdf',
         '00000000-0000-4331-d000-000000000001',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'TAX_PP20'
$$, 'new VERSION of the singleton accepted');

-- ── rule 3: a version may not change type ────────────────────
select throws_ok($$
  insert into public.company_documents (type_id, title, storage_path, superseded_by, created_by)
  select t.id, t.name_th, 'x331/morph.pdf',
         '00000000-0000-4331-d000-000000000002',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'REG_CERT'
$$, 'P0001', null, 'version cannot change the document type');

-- ── rule 4: label discipline ─────────────────────────────────
select throws_ok($$
  insert into public.company_documents (type_id, title, storage_path, expires_at, created_by)
  select t.id, t.name_th, 'x331/car-nolabel.pdf', '2027-01-01',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'INS_CAR'
$$, 'P0001', null, 'multi type without a label rejected');
select lives_ok($$
  insert into public.company_documents (id, type_id, title, label, storage_path, expires_at, created_by)
  select '00000000-0000-4331-d000-000000000003', t.id, t.name_th, 'กรุงเทพ – โครงการ A',
         '00000000-0000-4331-d000-000000000003/car.pdf', '2027-01-01',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'INS_CAR'
$$, 'multi type with a label accepted');
-- two live docs of the SAME multi type is the whole point
select lives_ok($$
  insert into public.company_documents (type_id, title, label, storage_path, expires_at, created_by)
  select t.id, t.name_th, 'กสิกร – โครงการ B', 'x331/car2.pdf', '2027-02-02',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'INS_CAR'
$$, 'second live doc of a MULTI type accepted');
select throws_ok($$
  insert into public.company_documents (type_id, title, label, storage_path, created_by)
  select t.id, t.name_th, 'ห้ามมีป้าย', 'x331/pp20-label.pdf',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'REG_MOA'
$$, 'P0001', null, 'singleton type with a label rejected');

-- ── rule 5: expiry discipline ────────────────────────────────
select throws_ok($$
  insert into public.company_documents (type_id, title, label, storage_path, created_by)
  select t.id, t.name_th, 'ไม่มีวันหมดอายุ', 'x331/car-noexp.pdf',
         '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'INS_LIABILITY'
$$, 'P0001', null, 'requires_expiry type without expires_at rejected');

-- ── tombstones skip every rule ───────────────────────────────
select lives_ok($$
  insert into public.company_documents (superseded_by, created_by)
  values ('00000000-0000-4331-d000-000000000003',
          '00000000-0000-4331-a000-000000000001')
$$, 'tombstone (retire) needs no type/label/expiry');

-- retiring the singleton frees its slot again
select lives_ok($$
  insert into public.company_documents (superseded_by, created_by)
  values ('00000000-0000-4331-d000-000000000002',
          '00000000-0000-4331-a000-000000000001')
$$, 'tombstone retires the singleton chain');
select lives_ok($$
  insert into public.company_documents (type_id, title, storage_path, created_by)
  select t.id, t.name_th, 'x331/pp20-again.pdf', '00000000-0000-4331-a000-000000000001'
  from public.company_document_types t where t.code = 'TAX_PP20'
$$, 'a retired singleton type can be uploaded again');

-- ── RPC gates: accounting refused ────────────────────────────
select throws_ok($$
  select public.create_company_document_category('XXX', 'ทดสอบ', 'Test', 99)
$$, '42501', null, 'accounting cannot create a category');
select throws_ok($$
  select public.create_company_document_type(
    'REG', 'REG_TEST', 'ทดสอบ', 'Test', null, true, false, false, 99)
$$, '42501', null, 'accounting cannot create a type');
select throws_ok($$
  select public.set_company_document_type_active('TAX_PP20', false)
$$, '42501', null, 'accounting cannot deactivate a type');

-- ── RPC gates: super_admin allowed ───────────────────────────
set local "request.jwt.claims" = '{"sub": "00000000-0000-4331-a000-000000000002"}';
select lives_ok($$
  select public.create_company_document_category('ZZZ', 'หมวดทดสอบ', 'Test category', 99)
$$, 'super_admin creates a category');
select lives_ok($$
  select public.create_company_document_type(
    'ZZZ', 'ZZZ_TEST', 'ประเภททดสอบ', 'Test type', 'คำอธิบาย', true, false, false, 1)
$$, 'super_admin creates a type');
select throws_ok($$
  select public.create_company_document_type(
    'ZZZ', 'ZZZ_TEST', 'ซ้ำ', 'Dup', null, true, false, false, 2)
$$, '23505', null, 'duplicate type code rejected');
select lives_ok($$
  select public.set_company_document_type_active('ZZZ_TEST', false)
$$, 'super_admin deactivates a type');
select is(
  (select is_active from public.company_document_types where code = 'ZZZ_TEST'),
  false, 'deactivate flipped the flag (no DELETE)');
reset role;

-- ── append-only still holds on the documents table ───────────
select throws_ok(
  $$update public.company_documents set label = 'nope'
    where id = '00000000-0000-4331-d000-000000000003'$$,
  'P0001', null, 'documents stay append-only');

select * from finish();
rollback;
