-- Spec 329 U1 — company_documents: append-only supersede + tombstone,
-- RLS (view roles read / accounting insert), private company-docs bucket,
-- storage INSERT policy. Runner form: begin → plan → asserts → finish → rollback.
begin;
select plan(27);

-- ── structure ────────────────────────────────────────────────
select has_table('public', 'company_documents', 'table exists');
select col_is_pk('public', 'company_documents', 'id', 'id is pk');
select col_type_is('public', 'company_documents', 'superseded_by', 'uuid', 'superseded_by uuid');
select ok(
  exists(select 1 from pg_constraint
    where conrelid = 'public.company_documents'::regclass
      and conname = 'company_documents_well_formed'),
  'well-formedness check pinned by name');
select is(
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'company_documents'
      and indexdef like '%UNIQUE%superseded_by%'
      and indexdef like '%WHERE%superseded_by IS NOT NULL%'),
  1::bigint, 'PARTIAL unique index on superseded_by (where-clause verified)');

-- ── RLS enabled + policies exist ─────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.company_documents'::regclass),
  true, 'RLS enabled');
select policies_are('public', 'company_documents',
  array['company documents readable by view roles',
        'company documents insert by accounting'],
  'exactly the two policies');

-- ── bucket private + storage INSERT policy pinned ────────────
select ok(
  exists(select 1 from storage.buckets where id = 'company-docs' and public = false),
  'company-docs bucket exists and is private');
select is(
  (select count(*) from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'company docs uploads by accounting'),
  1::bigint, 'storage INSERT policy exists');

-- ── seed two users (accounting + technician) ─────────────────
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4329-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spec329-acc@test.local'),
  ('00000000-0000-4329-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spec329-tech@test.local');
update public.users set role = 'accounting'
  where id = '00000000-0000-4329-a000-000000000001';
update public.users set role = 'technician'
  where id = '00000000-0000-4329-a000-000000000002';

-- Spec 331: every content row now needs a type_id, so this file gets its own
-- fixture type. MULTI + no-expiry on purpose — this file exercises the spec-329
-- supersede/tombstone mechanics, not spec-331's singleton/expiry rules (those
-- live in 331-company-document-types.test.sql), so the fixture must not trip them.
insert into public.company_document_categories (code, name_th)
values ('T329', 'หมวดทดสอบ 329');
insert into public.company_document_types (category_id, code, name_th, is_singleton)
select id, 'T329_ANY', 'ประเภททดสอบ 329', false
  from public.company_document_categories where code = 'T329';

-- runner collector must stay writable under role-sim (323 template)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ── accounting can INSERT (content row) ──────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000001"}';
select lives_ok($$
  insert into public.company_documents (id, type_id, label, title, storage_path, created_by)
  values ('00000000-0000-4329-d000-000000000001', (select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'หนังสือรับรองบริษัท',
          '00000000-0000-4329-d000-000000000001/cert.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, 'accounting inserts a document');

-- version row: content + superseded_by TOGETHER is legal here (chain = history)
select lives_ok($$
  insert into public.company_documents (id, type_id, label, title, storage_path, superseded_by, created_by)
  values ('00000000-0000-4329-d000-000000000002', (select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'หนังสือรับรองบริษัท',
          '00000000-0000-4329-d000-000000000002/cert-2.pdf',
          '00000000-0000-4329-d000-000000000001',
          '00000000-0000-4329-a000-000000000001')
$$, 'content row may supersede (version chain)');

-- single-child: second superseder of the same row → unique violation
select throws_ok($$
  insert into public.company_documents (type_id, label, title, storage_path, superseded_by, created_by)
  values ((select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'x', 'x/x.pdf', '00000000-0000-4329-d000-000000000001',
          '00000000-0000-4329-a000-000000000001')
$$, '23505', null, 'a row can be superseded once');

-- tombstone (retire): all payload NULL + superseded_by set
select lives_ok($$
  insert into public.company_documents (superseded_by, created_by)
  values ('00000000-0000-4329-d000-000000000002',
          '00000000-0000-4329-a000-000000000001')
$$, 'tombstone retires the head');

-- malformed shapes rejected by the well-formedness CHECK
select throws_ok($$
  insert into public.company_documents (created_by)
  values ('00000000-0000-4329-a000-000000000001')
$$, '23514', null, 'all-NULL row without supersede rejected');
select throws_ok($$
  insert into public.company_documents (type_id, label, storage_path, created_by)
  values ((select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'y/y.pdf', '00000000-0000-4329-a000-000000000001')
$$, '23514', null, 'payload without title rejected');
select throws_ok($$
  insert into public.company_documents (type_id, label, title, storage_path, created_by)
  values ((select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'blankpath', '   ', '00000000-0000-4329-a000-000000000001')
$$, '23514', null, 'whitespace-only storage_path rejected');
select throws_ok($$
  insert into public.company_documents (id, type_id, label, title, storage_path, superseded_by, created_by)
  values ('00000000-0000-4329-d000-00000000000e', (select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'self', 'self/x.pdf',
          '00000000-0000-4329-d000-00000000000e',
          '00000000-0000-4329-a000-000000000001')
-- spec 331's trigger now reaches this first (a row cannot supersede one that
-- does not exist — and a self-reference never does); the no_self_supersede
-- CHECK stays as belt-and-braces for any trigger-bypassing path.
$$, 'P0001', null, 'self-supersede rejected');

-- accounting reads what it wrote — scoped to THIS test's seeded ids: the
-- shared live DB already holds real company documents (the U2 verify uploaded
-- some), so a bare count(*) reds on live-data drift (caught 2026-07-19 when
-- it blocked an unrelated PR's required pgTAP check).
select is(
  (select count(*) from public.company_documents
    where created_by = '00000000-0000-4329-a000-000000000001'),
  3::bigint, 'accounting sees all rows it seeded');

-- current-set read (both filters) returns nothing (chain fully retired) —
-- scoped to the seeded chain (live docs are legitimately current).
select is(
  (select count(*) from public.company_documents d
    where d.created_by = '00000000-0000-4329-a000-000000000001'
      and d.storage_path is not null
      and not exists (select 1 from public.company_documents newer
                      where newer.superseded_by = d.id)),
  0::bigint, 'retired chain leaves the current set');

-- ── technician: read denied, insert denied ───────────────────
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000002"}';
select is((select count(*) from public.company_documents), 0::bigint,
  'technician sees zero rows');
select throws_ok($$
  insert into public.company_documents (type_id, label, title, storage_path, created_by)
  values ((select id from public.company_document_types where code='T329_ANY'), 'ทดสอบ', 'z', 'z/z.pdf', '00000000-0000-4329-a000-000000000002')
$$, '42501', null, 'technician insert denied');

-- ── storage: accounting upload allowed, technician denied ────
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000001"}';
select lives_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('company-docs', '00000000-0000-4329-d000-000000000001/cert.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, 'accounting uploads into company-docs');
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('company-docs', 'a/b/c.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, '42501', null, 'nested path rejected (one-folder shape)');
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000002"}';
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('company-docs', 'x/x.pdf', '00000000-0000-4329-a000-000000000002')
$$, '42501', null, 'technician upload denied');
reset role;

-- ── append-only freeze ───────────────────────────────────────
select throws_ok(
  $$update public.company_documents set note = 'nope'
    where id = '00000000-0000-4329-d000-000000000001'$$,
  'P0001', null, 'UPDATE blocked');
select throws_ok(
  $$delete from public.company_documents
    where id = '00000000-0000-4329-d000-000000000001'$$,
  'P0001', null, 'DELETE blocked');
-- 2 spec-329 freeze triggers (update/delete + truncate) + the spec-331
-- enforce-type INSERT trigger.
select is(
  (select count(*) from pg_trigger
    where tgrelid = 'public.company_documents'::regclass and not tgisinternal),
  3::bigint, 'freeze triggers + the spec-331 type guard present');

select * from finish();
rollback;
