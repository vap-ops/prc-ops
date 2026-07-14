begin;
select plan(19);

-- ============================================================================
-- Spec 130 U4 / ADR 0051 §6 — DC bank-change request + PM approval (anti-fraud).
-- A bound contractor submits a pending bank change (own only, one at a time);
-- a PM approves (applies to the live contact_bank) or rejects; site_admin never
-- sees the money. The request row is the audit trail.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000139', 'ua@portal.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110139', 'pm@portal.local', '{}'::jsonb),
  ('51000000-0000-4000-8000-000000000139', 'sa@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110139';
update public.users set role = 'site_admin'      where id = '51000000-0000-4000-8000-000000000139';

insert into public.contractors (id, name, created_by) values
  ('aa000000-0000-4000-8000-000000000139', 'Contractor A', '11111111-1111-1111-1111-111111110139'),
  ('bb000000-0000-4000-8000-000000000139', 'Contractor B', '11111111-1111-1111-1111-111111110139');

insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000139', 'aa000000-0000-4000-8000-000000000139');
update public.users set role = 'contractor' where id = 'a1000000-0000-4000-8000-000000000139';

-- A pending request for B, seeded directly (cross-party + queue fixture).
insert into public.contractor_bank_change_requests
  (id, contractor_id, bank_name, bank_account_no, bank_account_name, requested_by) values
  ('cb000000-0000-4000-8000-000000000139', 'bb000000-0000-4000-8000-000000000139',
   'B Bank', '999', 'B Co', '11111111-1111-1111-1111-111111110139');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog.
select has_table('public', 'contractor_bank_change_requests', 'request table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.contractor_bank_change_requests'::regclass),
  'RLS enabled');
select enum_has_labels('public', 'contractor_change_status',
  array['pending', 'approved', 'rejected'], 'contractor_change_status labels');

-- B. submit — contractor only, own, one pending at a time.
-- Spec 317 U5: re-signatured to 4 args (passbook photo REQUIRED, own
-- contractor/<id>/ folder, object must exist in contact-docs).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000139"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'contractor/aa000000-0000-4000-8000-000000000139/ua1.jpg'),
  (gen_random_uuid(), 'contact-docs',
   'contractor/aa000000-0000-4000-8000-000000000139/ua2.jpg');
select isnt(
  (select public.submit_contractor_bank_change('กสิกรไทย', '1112223334', 'Contractor A',
     'contractor/aa000000-0000-4000-8000-000000000139/ua1.jpg')),
  null, 'uA submits a bank change');
select is(
  (select count(*) from public.contractor_bank_change_requests
    where contractor_id = 'aa000000-0000-4000-8000-000000000139' and status = 'pending'),
  1::bigint, 'one pending request for Contractor A');
select throws_ok(
  $$ select public.submit_contractor_bank_change('x', '1', 'y',
       'contractor/aa000000-0000-4000-8000-000000000139/ua2.jpg') $$,
  'P0001', null, 'a second pending request is refused');

set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000139"}';
select throws_ok(
  $$ select public.submit_contractor_bank_change('x', '1', 'y', null) $$,
  '42501', null, 'a non-contractor (site_admin) cannot submit');

-- C. RLS read scoping.
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000139"}';
select is((select count(*) from public.contractor_bank_change_requests),
  1::bigint, 'uA sees only their own request (not B''s)');
set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000139"}';
select is((select count(*) from public.contractor_bank_change_requests),
  0::bigint, 'site_admin sees no bank-change requests (money hidden)');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110139"}';
select is((select count(*) from public.contractor_bank_change_requests),
  2::bigint, 'pm sees the full queue (A + B)');

-- D. decide — pm/super only; approve applies, reject does not.
set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000139"}';
select throws_ok(
  $$ select public.decide_contractor_bank_change(
       (select id from public.contractor_bank_change_requests
         where contractor_id = 'bb000000-0000-4000-8000-000000000139'), true) $$,
  '42501', null, 'site_admin cannot decide');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110139"}';
select lives_ok(
  $$ select public.decide_contractor_bank_change(
       (select id from public.contractor_bank_change_requests
         where contractor_id = 'aa000000-0000-4000-8000-000000000139'), true) $$,
  'pm approves Contractor A''s request');

reset role;
select is(
  (select bank_account_no from public.contact_bank
    where contractor_id = 'aa000000-0000-4000-8000-000000000139'),
  '1112223334', 'approve applied the proposed bank to the live contact_bank');
select is(
  (select status from public.contractor_bank_change_requests
    where contractor_id = 'aa000000-0000-4000-8000-000000000139'),
  'approved'::public.contractor_change_status, 'request marked approved');
select is(
  (select decided_by from public.contractor_bank_change_requests
    where contractor_id = 'aa000000-0000-4000-8000-000000000139'),
  '11111111-1111-1111-1111-111111110139'::uuid, 'decided_by = the PM');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110139"}';
select throws_ok(
  $$ select public.decide_contractor_bank_change(
       (select id from public.contractor_bank_change_requests
         where contractor_id = 'aa000000-0000-4000-8000-000000000139'), true) $$,
  'P0001', null, 're-deciding an already-decided request is refused');
select lives_ok(
  $$ select public.decide_contractor_bank_change(
       'cb000000-0000-4000-8000-000000000139', false) $$,
  'pm rejects Contractor B''s request');

reset role;
select is(
  (select status from public.contractor_bank_change_requests
    where id = 'cb000000-0000-4000-8000-000000000139'),
  'rejected'::public.contractor_change_status, 'B''s request marked rejected');
select is(
  (select count(*) from public.contact_bank
    where contractor_id = 'bb000000-0000-4000-8000-000000000139'),
  0::bigint, 'reject did NOT write a live bank record for B');

select * from finish();
rollback;
