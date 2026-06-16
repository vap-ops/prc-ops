begin;
select plan(18);

-- ============================================================================
-- Spec 131 U2c / ADR 0051 — external-write storage RLS for DC contact documents.
-- A bound DC may upload + read ONLY their own contractor's path; never another
-- contractor's. Proven THREE ways (defense in depth):
--   (1) storage.objects INSERT/SELECT RLS — exercised with real rows (the runner
--       has no Storage API — spec 23 — but storage.objects is a plain RLS table).
--   (2) add_contact_document widened — a bound DC records OWN doc, foreign 42501.
--   (3) contact_attachments own-contractor SELECT — DC reads own rows only.
-- The positive end-to-end upload (a real DC claims an invite and uploads from the
-- phone) is an OPERATOR smoke test — pgTAP cannot drive the Storage API.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000153', 'ua@portal.local', '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000153', 'ub@portal.local', '{}'::jsonb),
  ('99000000-0000-4000-8000-000000000153', 'vi@portal.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110153', 'pm@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110153';

insert into public.contractors (id, name, status, created_by) values
  ('aa000000-0000-4000-8000-000000000153', 'Contractor A', 'active', '11111111-1111-1111-1111-111111110153'),
  ('bb000000-0000-4000-8000-000000000153', 'Contractor B', 'active', '11111111-1111-1111-1111-111111110153');
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000153', 'aa000000-0000-4000-8000-000000000153'),
  ('a2000000-0000-4000-8000-000000000153', 'bb000000-0000-4000-8000-000000000153');
update public.users set role = 'contractor'
  where id in ('a1000000-0000-4000-8000-000000000153', 'a2000000-0000-4000-8000-000000000153');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ── A. Posture pins (owner context) ─────────────────────────────────────────
-- contact_attachments gains own-contractor SELECT (was zero authenticated access);
-- INSERT stays RPC-only.
select is(has_table_privilege('authenticated', 'public.contact_attachments', 'SELECT'),
  true, 'authenticated now has SELECT on contact_attachments (U2c own-contractor RLS)');
select is(has_table_privilege('authenticated', 'public.contact_attachments', 'INSERT'),
  false, 'authenticated still has NO direct INSERT on contact_attachments (RPC-only)');

-- ── B. Policy presence + shape (the external pair on contact-docs) ───────────
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'contact doc uploads by bound contractor' and cmd = 'INSERT'),
  1, 'external INSERT policy exists by name');
select ok(
  (select with_check like '%foldername%' and with_check like '%current_user_contractor_id%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'contact doc uploads by bound contractor'),
  'external INSERT policy binds the path (foldername) AND the owner (current_user_contractor_id)');
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'contact doc reads by bound contractor' and cmd = 'SELECT'),
  1, 'external SELECT policy exists by name');
select ok(
  (select qual like '%foldername%' and qual like '%current_user_contractor_id%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'contact doc reads by bound contractor'),
  'external SELECT policy binds the path (foldername) AND the owner (current_user_contractor_id)');

-- ── C. storage.objects INSERT RLS — real rows ───────────────────────────────
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000153"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('contact-docs', 'contractor/aa000000-0000-4000-8000-000000000153/d1000000-0000-4000-8000-000000000153.jpeg') $$,
  'bound DC A uploads to its OWN contractor path');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('contact-docs', 'contractor/bb000000-0000-4000-8000-000000000153/d3000000-0000-4000-8000-000000000153.jpeg') $$,
  '42501', null, 'bound DC A CANNOT upload to contractor B''s path');

set local "request.jwt.claims" = '{"sub": "a2000000-0000-4000-8000-000000000153"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('contact-docs', 'contractor/bb000000-0000-4000-8000-000000000153/d2000000-0000-4000-8000-000000000153.jpeg') $$,
  'bound DC B uploads to its OWN path (this object is B''s fixture for the read test)');

set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000153"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('contact-docs', 'contractor/aa000000-0000-4000-8000-000000000153/d4000000-0000-4000-8000-000000000153.jpeg') $$,
  '42501', null, 'an unbound visitor (NULL contractor) cannot upload anywhere in contact-docs');

-- ── D. storage.objects SELECT RLS — own path only ───────────────────────────
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000153"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'contact-docs' and name like 'contractor/aa000000-0000-4000-8000-000000000153/%'),
  1, 'DC A reads its OWN contact-docs object');
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'contact-docs' and name like 'contractor/bb000000-0000-4000-8000-000000000153/%'),
  0, 'DC A CANNOT read contractor B''s contact-docs object');

-- ── E. add_contact_document widened — own-doc allowed, foreign refused ───────
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000153"}';
select lives_ok(
  $$ select public.add_contact_document(
       'aa000000-0000-4000-8000-000000000153', null, null, 'consent',
       'contractor/aa000000-0000-4000-8000-000000000153/e1000000-0000-4000-8000-000000000153.jpeg') $$,
  'bound DC A records its OWN document via add_contact_document');
select throws_ok(
  $$ select public.add_contact_document(
       'bb000000-0000-4000-8000-000000000153', null, null, 'id_card',
       'contractor/bb000000-0000-4000-8000-000000000153/e2000000-0000-4000-8000-000000000153.jpeg') $$,
  '42501', null, 'bound DC A CANNOT record a document for contractor B (coalesced self-check)');

set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000153"}';
select throws_ok(
  $$ select public.add_contact_document(
       'aa000000-0000-4000-8000-000000000153', null, null, 'id_card', 'x/y/z.jpeg') $$,
  '42501', null, 'an unbound visitor cannot record any document (3-valued-logic gate holds)');

-- ── F. contact_attachments own-contractor SELECT (the row A just recorded) ───
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000153"}';
select is(
  (select count(*)::int from public.contact_attachments
     where contractor_id = 'aa000000-0000-4000-8000-000000000153'),
  1, 'bound DC A reads its OWN contact_attachments row');
set local "request.jwt.claims" = '{"sub": "a2000000-0000-4000-8000-000000000153"}';
select is(
  (select count(*)::int from public.contact_attachments
     where contractor_id = 'aa000000-0000-4000-8000-000000000153'),
  0, 'bound DC B CANNOT read contractor A''s contact_attachments');
set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000153"}';
select is(
  (select count(*)::int from public.contact_attachments),
  0, 'an unbound visitor reads no contact_attachments');

reset role;

select * from finish();
rollback;
