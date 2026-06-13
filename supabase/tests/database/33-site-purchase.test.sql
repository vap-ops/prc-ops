begin;
select plan(26);

-- Spec 66 / ADR 0043 — on-site purchases (record_site_purchase +
-- acknowledge_site_purchase) and invoice attachments.
--
-- The notification-silence guarantee (a site purchase is born
-- status='site_purchased', and notify_pr_created keys on status='requested',
-- so no outbox row is written) is enforced by construction, not asserted
-- here — the requested fixture below deliberately fires that trigger and
-- would confound a global outbox count.

-- ============================================================================
-- Setup as postgres (bypasses RLS). Four users + roles, one project + WP,
-- a 'requested' and an 'on_route' requisition fixture for the invoice-RLS
-- and trigger-non-interference assertions.
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-1111111166aa', 'super@sp-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-2222222266aa', 'sa@sp-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333366aa', 'pm@sp-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444466aa', 'visitor@sp-test.local', '{}'::jsonb);

update public.users set role = 'super_admin', full_name = 'ซุปเปอร์'
  where id = '11111111-1111-1111-1111-1111111166aa';
update public.users set role = 'site_admin', full_name = 'ช่างเอ'
  where id = '22222222-2222-2222-2222-2222222266aa';
update public.users set role = 'project_manager', full_name = 'พีเอ็ม'
  where id = '33333333-3333-3333-3333-3333333366aa';
-- '4444…' stays visitor.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc66aa', 'PRC-SP', 'Site purchase fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa',
   'cccccccc-cccc-cccc-cccc-cccccccc66aa', 'WP-SP', 'SP fixture WP');

-- A 'requested' requisition (SA-owned) and an 'on_route' one (postgres
-- sets fact columns directly, bypassing the column grants).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status)
values
  ('a0000000-0000-4000-8000-0000000066aa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa', 'REQ-FIXTURE', 1, 'ea',
   '22222222-2222-2222-2222-2222222266aa', 'requested');
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   purchased_at, shipped_at)
values
  ('a1000000-0000-4000-8000-0000000066aa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa', 'ONROUTE-FIXTURE', 1, 'ea',
   '22222222-2222-2222-2222-2222222266aa', 'on_route', now(), now());

-- ============================================================================
-- A. Function shape.
-- ============================================================================
select has_function('public', 'record_site_purchase',
  array['uuid', 'text', 'numeric', 'text'], 'record_site_purchase exists');
select has_function('public', 'acknowledge_site_purchase',
  array['uuid'], 'acknowledge_site_purchase exists');
select is(
  (select prosecdef from pg_proc where proname = 'record_site_purchase'),
  true, 'record_site_purchase is SECURITY DEFINER');
select is(
  (select prosecdef from pg_proc where proname = 'acknowledge_site_purchase'),
  true, 'acknowledge_site_purchase is SECURITY DEFINER');
-- Ack columns are RPC-only — not in the authenticated UPDATE grant.
select is(
  has_column_privilege('authenticated', 'public.purchase_requests',
                       'acknowledged_at', 'UPDATE'),
  false, 'authenticated cannot UPDATE acknowledged_at directly');

-- ============================================================================
-- B. record_site_purchase (role-sim authenticated).
-- ============================================================================
-- The runner collects assertion output into a temp table (_tap_buf, with a
-- serial PK) owned by the connection role; grant the table + its sequence
-- to authenticated so the wrapped inserts succeed while we hold that role.
grant insert on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;
set local role authenticated;

-- B.1 visitor is refused.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444466aa"}';
select throws_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa', 'ปูน', 5, 'ถุง') $$,
  '42501', null, 'visitor cannot record a site purchase');

-- B.2 SA records one (side-effect: creates item 'SITE-BUY-66').
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222266aa"}';
select lives_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa', 'SITE-BUY-66', 5, 'ถุง') $$,
  'SA records an on-site purchase');

select is(
  (select source from public.purchase_requests where item_description = 'SITE-BUY-66'),
  'site_purchase', 'site purchase carries source=site_purchase');
select is(
  (select status::text from public.purchase_requests where item_description = 'SITE-BUY-66'),
  'site_purchased', 'site purchase is status=site_purchased');
select ok(
  (select purchased_at is not null and delivered_at is not null
     from public.purchase_requests where item_description = 'SITE-BUY-66'),
  'site purchase stamps purchased_at and delivered_at');
select is(
  (select received_by from public.purchase_requests where item_description = 'SITE-BUY-66'),
  'ช่างเอ', 'received_by is the recording actor name');

-- B.3 exactly one insert audit row carrying source=site_purchase; no
--     delivery-audit row (no UPDATE-path trigger fired).
select is(
  (select count(*)::int from public.audit_log
     where target_id = (select id from public.purchase_requests
                          where item_description = 'SITE-BUY-66')
       and action = 'insert'
       and payload->>'source' = 'site_purchase'),
  1, 'one insert audit row with source=site_purchase');
select is(
  (select count(*)::int from public.audit_log
     where target_id = (select id from public.purchase_requests
                          where item_description = 'SITE-BUY-66')
       and action = 'purchase_request_delivery'),
  0, 'no delivery-audit row (no UPDATE-path trigger fired)');

-- B.4 input re-checks.
select throws_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa', 'ปูน', 0, 'ถุง') $$,
  'P0001', null, 'quantity must be positive');
select throws_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee66aa', '   ', 5, 'ถุง') $$,
  'P0001', null, 'item description must be non-blank');
select throws_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeeffff', 'ปูน', 5, 'ถุง') $$,
  'P0001', null, 'unknown work package is rejected');

-- ============================================================================
-- C. acknowledge_site_purchase.
-- ============================================================================
-- C.1 SA cannot acknowledge.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222266aa"}';
select throws_ok(
  $$ select public.acknowledge_site_purchase(
       (select id from public.purchase_requests where item_description = 'SITE-BUY-66')) $$,
  '42501', null, 'SA cannot acknowledge a site purchase');

-- C.2 PM acknowledges.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333366aa"}';
select lives_ok(
  $$ select public.acknowledge_site_purchase(
       (select id from public.purchase_requests where item_description = 'SITE-BUY-66')) $$,
  'PM acknowledges the site purchase');
select ok(
  (select acknowledged_at is not null
       and acknowledged_by = '33333333-3333-3333-3333-3333333366aa'
     from public.purchase_requests where item_description = 'SITE-BUY-66'),
  'acknowledgement stamps acknowledged_at + acknowledged_by');

-- C.3 idempotent — a second ack is refused.
select throws_ok(
  $$ select public.acknowledge_site_purchase(
       (select id from public.purchase_requests where item_description = 'SITE-BUY-66')) $$,
  'P0001', null, 'acknowledging twice is refused');

-- C.4 cannot acknowledge a non-site (requested) requisition.
select throws_ok(
  $$ select public.acknowledge_site_purchase('a0000000-0000-4000-8000-0000000066aa') $$,
  'P0001', null, 'acknowledge is scoped to site purchases');

-- ============================================================================
-- D. Invoice attachment RLS (role authenticated).
-- ============================================================================
-- D.1 SA attaches an invoice to the site-purchased parent.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222266aa"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ((select id from public.purchase_requests where item_description = 'SITE-BUY-66'),
             'image', 'invoice', 'p/pr/inv1.jpeg',
             '22222222-2222-2222-2222-2222222266aa') $$,
  'SA attaches an invoice to a site-purchased parent');

-- D.2 invoice on a 'requested' parent is denied (RLS — invoices need
--     goods/docs to exist).
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a0000000-0000-4000-8000-0000000066aa', 'image', 'invoice',
             'p/pr/inv2.jpeg', '22222222-2222-2222-2222-2222222266aa') $$,
  '42501', null, 'invoice on a requested parent is denied');

-- D.3 invoice on an on_route parent is allowed AND does NOT complete the
--     delivery (the auto-complete trigger keys on delivery_confirmation).
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a1000000-0000-4000-8000-0000000066aa', 'image', 'invoice',
             'p/pr/inv3.jpeg', '22222222-2222-2222-2222-2222222266aa') $$,
  'SA attaches an invoice to an on_route parent');
select ok(
  (select status = 'on_route' and delivered_at is null
     from public.purchase_requests where id = 'a1000000-0000-4000-8000-0000000066aa'),
  'invoice attach does not advance the on_route parent (trigger non-interference)');

-- D.4 invoice rows are append-only: authenticated has no UPDATE privilege
--     (the privilege layer fires before the P0001 block trigger that
--     catches privileged roles — three-layer append-only, ADR 0004).
select throws_ok(
  $$ update public.purchase_request_attachments set storage_path = 'x'
       where purpose = 'invoice' $$,
  '42501', null, 'invoice attachments are append-only (no UPDATE grant)');

-- Back to the connection role so finish() + the buffer read-back run as
-- the table owner (the authenticated role cannot write _tap_buf).
reset role;

select * from finish();
rollback;
