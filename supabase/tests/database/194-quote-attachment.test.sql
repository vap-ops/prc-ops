begin;
select plan(12);

-- ============================================================================
-- Spec 182 U4 — quote attachments: a supplier quotation doc linked to a
-- purchase_quotes row (purpose='quote' + quote_id). Back-office WRITE on an
-- APPROVED PR, linked to a quote ON THAT PR; and back-office READ ONLY (a
-- RESTRICTIVE select — a quotation shows prices, the money posture). site_admin
-- may see the parent's other rows but NOT the quote doc.
-- ============================================================================

-- A. Schema shape (introspection — no role needed).
select is(
  (select count(*)::int from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'purchase_request_attachment_purpose' and e.enumlabel = 'quote'),
  1, 'purpose enum has the value ''quote''');
select has_column('public', 'purchase_request_attachments', 'quote_id',
  'purchase_request_attachments.quote_id exists');
select is(
  (select confdeltype from pg_constraint
     where conrelid = 'public.purchase_request_attachments'::regclass
       and conname = 'purchase_request_attachments_quote_id_fkey'),
  'c', 'quote_id FK to purchase_quotes is ON DELETE CASCADE');
select is(
  (select count(*)::int from pg_constraint where conname = 'pra_quote_id_shape'),
  1, 'pra_quote_id_shape CHECK exists (quote_id only on quote rows)');
select has_column('public', 'purchase_request_attachments_current', 'quote_id',
  'the current-state view exposes quote_id');

-- ============================================================================
-- Fixtures (postgres bypasses RLS + column grants).
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-111111111194', 'proc@a194.local', '{}'::jsonb),
  ('d3333333-3333-3333-3333-333333333194', 'sa@a194.local',   '{}'::jsonb),
  ('d9999999-9999-9999-9999-999999999194', 'super@a194.local','{}'::jsonb);
update public.users set role='procurement' where id='d1111111-1111-1111-1111-111111111194';
update public.users set role='site_admin'  where id='d3333333-3333-3333-3333-333333333194';
update public.users set role='super_admin' where id='d9999999-9999-9999-9999-999999999194';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000194', 'A194', 'quote doc 194');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000194', 'aa000000-0000-0000-0000-000000000194', 'WP194', 'งาน 194');
-- Spec 143 / ADR 0056: PR visibility is membership-scoped; enrol site_admin so
-- it can read the parent PR (procurement keeps its cross-project read — spec 102).
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000194',
   'd3333333-3333-3333-3333-333333333194',
   'd3333333-3333-3333-3333-333333333194');
insert into public.suppliers (id, name, created_by) values
  ('51000000-0000-0000-0000-000000000194', 'ส.รุ่งเรือง', 'd9999999-9999-9999-9999-999999999194');

-- Two APPROVED PRs (quotable); a1 is the subject, a2 owns a quote used for the
-- cross-PR rejection.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, status, requested_by, approved_by, source) values
  ('a1000000-0000-0000-0000-000000000194', 'cc000000-0000-0000-0000-000000000194',
   'เหล็กข้ออ้อย 12 มิล', 50, 'ท่อน', 'approved',
   'd9999999-9999-9999-9999-999999999194', 'd9999999-9999-9999-9999-999999999194', 'app'),
  ('a2000000-0000-0000-0000-000000000194', 'cc000000-0000-0000-0000-000000000194',
   'ปูนถุง', 100, 'ถุง', 'approved',
   'd9999999-9999-9999-9999-999999999194', 'd9999999-9999-9999-9999-999999999194', 'app');

insert into public.purchase_quotes (id, purchase_request_id, supplier_id, unit_price, created_by) values
  ('41000000-0000-0000-0000-000000000194', 'a1000000-0000-0000-0000-000000000194',
   '51000000-0000-0000-0000-000000000194', 92, 'd9999999-9999-9999-9999-999999999194'),
  ('42000000-0000-0000-0000-000000000194', 'a2000000-0000-0000-0000-000000000194',
   '51000000-0000-0000-0000-000000000194', 95, 'd9999999-9999-9999-9999-999999999194');

-- A reference attachment on a1 — site_admin must still see this (proves the
-- RESTRICTIVE gate targets ONLY quote rows, and that site_admin sees the parent).
insert into public.purchase_request_attachments
  (id, purchase_request_id, kind, purpose, storage_path, created_by) values
  ('b0000000-0000-0000-0000-000000000194', 'a1000000-0000-0000-0000-000000000194',
   'image', 'reference', 'aa000000-0000-0000-0000-000000000194/a1/ref.jpg',
   'd9999999-9999-9999-9999-999999999194');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. INSERT policy — the 'quote' arm.
-- ============================================================================
-- B.1 procurement attaches a quote doc on the approved PR, linked to its quote.
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-111111111194"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, quote_id, kind, purpose, storage_path, created_by)
     values ('b1000000-0000-0000-0000-000000000194', 'a1000000-0000-0000-0000-000000000194',
             '41000000-0000-0000-0000-000000000194', 'image', 'quote',
             'aa000000-0000-0000-0000-000000000194/a1/q1.jpg',
             'd1111111-1111-1111-1111-111111111194') $$,
  'procurement attaches a quote doc (approved PR, quote on this PR)');

-- B.2 site_admin cannot attach a quote doc (back-office only — it bears prices).
set local "request.jwt.claims" = '{"sub": "d3333333-3333-3333-3333-333333333194"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, quote_id, kind, purpose, storage_path, created_by)
     values ('b2000000-0000-0000-0000-000000000194', 'a1000000-0000-0000-0000-000000000194',
             '41000000-0000-0000-0000-000000000194', 'image', 'quote',
             'aa000000-0000-0000-0000-000000000194/a1/q2.jpg',
             'd3333333-3333-3333-3333-333333333194') $$,
  '42501', null, 'site_admin cannot attach a quote doc');

-- B.3 the quote_id must belong to THIS PR (qb is on a2) → rejected.
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-111111111194"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, quote_id, kind, purpose, storage_path, created_by)
     values ('b3000000-0000-0000-0000-000000000194', 'a1000000-0000-0000-0000-000000000194',
             '42000000-0000-0000-0000-000000000194', 'image', 'quote',
             'aa000000-0000-0000-0000-000000000194/a1/q3.jpg',
             'd1111111-1111-1111-1111-111111111194') $$,
  '42501', null, 'a quote from another PR cannot be linked here');

-- ============================================================================
-- C. RESTRICTIVE read gate (quote rows = money → back office only).
-- ============================================================================
-- C.1 site_admin DOES see the parent's reference row (permissive + site-wide).
set local "request.jwt.claims" = '{"sub": "d3333333-3333-3333-3333-333333333194"}';
select is(
  (select count(*)::int from public.purchase_request_attachments
     where purchase_request_id = 'a1000000-0000-0000-0000-000000000194' and purpose = 'reference'),
  1, 'site_admin sees the parent reference attachment');
-- C.2 but NOT the quote doc.
select is(
  (select count(*)::int from public.purchase_request_attachments
     where purchase_request_id = 'a1000000-0000-0000-0000-000000000194' and purpose = 'quote'),
  0, 'site_admin cannot read the quote doc (RESTRICTIVE gate)');
-- C.3 and the gate flows through the current-state view too.
select is(
  (select count(*)::int from public.purchase_request_attachments_current
     where purchase_request_id = 'a1000000-0000-0000-0000-000000000194' and purpose = 'quote'),
  0, 'the quote doc is hidden from site_admin via the _current view');

-- C.4 back office reads the quote doc.
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-111111111194"}';
select is(
  (select count(*)::int from public.purchase_request_attachments
     where purchase_request_id = 'a1000000-0000-0000-0000-000000000194' and purpose = 'quote'),
  1, 'procurement reads the quote doc');

reset role;

select * from finish();
rollback;
