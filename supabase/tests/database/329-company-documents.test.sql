-- Spec 329 U1 — company_documents: append-only supersede + tombstone,
-- RLS (view roles read / accounting insert), private company-docs bucket,
-- storage INSERT policy. Runner form: begin → plan → asserts → finish → rollback.
begin;
select plan(25);

-- ── structure ────────────────────────────────────────────────
select has_table('public', 'company_documents', 'table exists');
select col_is_pk('public', 'company_documents', 'id', 'id is pk');
select col_type_is('public', 'company_documents', 'superseded_by', 'uuid', 'superseded_by uuid');
select has_check('public', 'company_documents', 'has check constraint');
select is(
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'company_documents'
      and indexdef like '%UNIQUE%superseded_by%'),
  1::bigint, 'partial unique index on superseded_by');

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

-- runner collector must stay writable under role-sim (323 template)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ── accounting can INSERT (content row) ──────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000001"}';
select lives_ok($$
  insert into public.company_documents (id, title, storage_path, created_by)
  values ('00000000-0000-4329-d000-000000000001', 'หนังสือรับรองบริษัท',
          '00000000-0000-4329-d000-000000000001/cert.pdf',
          '00000000-0000-4329-a000-000000000001')
$$, 'accounting inserts a document');

-- version row: content + superseded_by TOGETHER is legal here (chain = history)
select lives_ok($$
  insert into public.company_documents (id, title, storage_path, superseded_by, created_by)
  values ('00000000-0000-4329-d000-000000000002', 'หนังสือรับรองบริษัท',
          '00000000-0000-4329-d000-000000000002/cert-2.pdf',
          '00000000-0000-4329-d000-000000000001',
          '00000000-0000-4329-a000-000000000001')
$$, 'content row may supersede (version chain)');

-- single-child: second superseder of the same row → unique violation
select throws_ok($$
  insert into public.company_documents (title, storage_path, superseded_by, created_by)
  values ('x', 'x/x.pdf', '00000000-0000-4329-d000-000000000001',
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
  insert into public.company_documents (storage_path, created_by)
  values ('y/y.pdf', '00000000-0000-4329-a000-000000000001')
$$, '23514', null, 'payload without title rejected');

-- accounting reads what it wrote
select is(
  (select count(*) from public.company_documents),
  3::bigint, 'accounting sees all rows');

-- current-set read (both filters) returns nothing (chain fully retired)
select is(
  (select count(*) from public.company_documents d
    where d.storage_path is not null
      and not exists (select 1 from public.company_documents newer
                      where newer.superseded_by = d.id)),
  0::bigint, 'retired chain leaves the current set');

-- ── technician: read denied, insert denied ───────────────────
set local "request.jwt.claims" = '{"sub": "00000000-0000-4329-a000-000000000002"}';
select is((select count(*) from public.company_documents), 0::bigint,
  'technician sees zero rows');
select throws_ok($$
  insert into public.company_documents (title, storage_path, created_by)
  values ('z', 'z/z.pdf', '00000000-0000-4329-a000-000000000002')
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
select is(
  (select count(*) from pg_trigger
    where tgrelid = 'public.company_documents'::regclass and not tgisinternal),
  2::bigint, 'both freeze triggers present');

select * from finish();
rollback;
