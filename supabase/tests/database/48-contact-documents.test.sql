begin;
select plan(14);

-- ============================================================================
-- Spec 97 — contact_attachments: contact documents (ID card / bank book).
-- Zero authenticated access (RLS on, no policies/grants); write only via
-- add_contact_document (PM/super), read only via service-role admin. Append-only
-- (block trigger). Typed FKs with exactly-one-target.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-2222222248ff', 'sa@cd-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333348ff', 'pm@cd-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444448ff', 'visitor@cd-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222248ff';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333348ff';
-- 4444…48ff keeps default 'visitor'.

insert into public.contractors (id, name, created_by) values
  ('c0000000-48ff-48ff-48ff-48ff48ff48ff', 'เอกสารเทสต์',
   '33333333-3333-3333-3333-3333333348ff');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- B. Catalog + isolation (owner context).
select has_table('public', 'contact_attachments', 'contact_attachments exists');
select is((select relrowsecurity from pg_class where oid = 'public.contact_attachments'::regclass),
  true, 'RLS enabled on contact_attachments');
-- Spec 131 U2c widened SELECT to authenticated (RLS-scoped to the bound DC's own
-- contractor via the contact_attachments own-contractor policy); internal staff
-- still read via the service-role admin client. INSERT stays RPC-only.
select is(has_table_privilege('authenticated', 'public.contact_attachments', 'SELECT'),
  true, 'authenticated has SELECT on contact_attachments (U2c own-contractor RLS scopes it)');
select is(has_table_privilege('authenticated', 'public.contact_attachments', 'INSERT'),
  false, 'authenticated has NO direct INSERT on contact_attachments (RPC-only writer)');
select has_function('public', 'add_contact_document', 'add_contact_document RPC exists');

-- exactly-one-target CHECK.
select throws_ok(
  $$ insert into public.contact_attachments (purpose, storage_path, uploaded_by)
     values ('id_card', 'x', '33333333-3333-3333-3333-3333333348ff') $$,
  '23514', null, 'exactly-one-target CHECK rejects zero targets');
select throws_ok(
  $$ insert into public.contact_attachments (contractor_id, supplier_id, purpose, storage_path, uploaded_by)
     values ('c0000000-48ff-48ff-48ff-48ff48ff48ff', 'c0000000-48ff-48ff-48ff-48ff48ff48ff',
             'id_card', 'x', '33333333-3333-3333-3333-3333333348ff') $$,
  '23514', null, 'exactly-one-target CHECK rejects two targets');

-- Append-only: insert a valid row (owner bypasses RLS), then update/delete fail.
insert into public.contact_attachments (contractor_id, purpose, storage_path, uploaded_by)
values ('c0000000-48ff-48ff-48ff-48ff48ff48ff', 'id_card',
        'contractor/c0000000-48ff-48ff-48ff-48ff48ff48ff/aaaaaaaa-48ff-48ff-48ff-48ff48ff48ff.jpeg',
        '33333333-3333-3333-3333-3333333348ff');
select throws_ok(
  $$ update public.contact_attachments set storage_path = 'y'
     where contractor_id = 'c0000000-48ff-48ff-48ff-48ff48ff48ff' $$,
  'P0001', null, 'append-only: UPDATE is blocked');
select throws_ok(
  $$ delete from public.contact_attachments
     where contractor_id = 'c0000000-48ff-48ff-48ff-48ff48ff48ff' $$,
  'P0001', null, 'append-only: DELETE is blocked');

-- C. Role-sim.
set local role authenticated;

-- SA cannot call the RPC (PII/bank-adjacent — pm/super only).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222248ff"}';
select throws_ok(
  $$ select public.add_contact_document(
       'c0000000-48ff-48ff-48ff-48ff48ff48ff', null, null, 'id_card',
       'contractor/c0000000-48ff-48ff-48ff-48ff48ff48ff/bbbbbbbb-48ff-48ff-48ff-48ff48ff48ff.jpeg') $$,
  '42501', null, 'site_admin cannot call add_contact_document');

-- Visitor cannot call it.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444448ff"}';
select throws_ok(
  $$ select public.add_contact_document(
       'c0000000-48ff-48ff-48ff-48ff48ff48ff', null, null, 'bank_book', 'x/y/z.jpeg') $$,
  '42501', null, 'visitor cannot call add_contact_document');

-- PM can call it (records a row).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333348ff"}';
select lives_ok(
  $$ select public.add_contact_document(
       'c0000000-48ff-48ff-48ff-48ff48ff48ff', null, null, 'bank_book',
       'contractor/c0000000-48ff-48ff-48ff-48ff48ff48ff/cccccccc-48ff-48ff-48ff-48ff48ff48ff.jpeg') $$,
  'PM records a contact document');

reset role;

-- D. Outcome (owner context) — 1 owner-inserted id_card + 1 RPC bank_book.
select is(
  (select count(*)::int from public.contact_attachments
     where contractor_id = 'c0000000-48ff-48ff-48ff-48ff48ff48ff'),
  2, 'append-only kept the owner row and added the RPC row');

-- The private bucket exists.
select is(
  (select count(*)::int from storage.buckets where id = 'contact-docs'),
  1, 'contact-docs storage bucket exists');

select * from finish();
rollback;
