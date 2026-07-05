begin;
select plan(36);

-- ============================================================================
-- Spec 259 / amends ADR 0038 — void_purchase_order(p_po_id): procurement
-- self-service revert of a mistakenly-created PO. Pins: role gate (mirrors
-- create_purchase_order's back-office set), 404, the shipped/on_route guard,
-- the GL-safety pair (reverse a posted purchase entry + skip a still-pending
-- outbox job so the drain can never post it after void), the full unlink
-- (members back to exactly pre-purchase shape), the PO+deliveries delete, the
-- audit row, and — the actual acceptance criterion — that a reverted ticket
-- is free to be bundled into a brand-new, correct PO.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110259', 'pm@void.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440259', 'proc@void.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220259', 'sa@void.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330259', 'vi@void.local',   '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550259', 'pmgr@void.local', '{}'::jsonb);
update public.users set role = 'project_manager'     where id = '11111111-1111-1111-1111-111111110259';
update public.users set role = 'procurement'         where id = '44444444-4444-4444-4444-444444440259';
update public.users set role = 'site_admin'          where id = '22222222-2222-2222-2222-222222220259';
-- Spec 261 / ADR 0070 item 1: void is manager-only; a procurement_manager voids.
update public.users set role = 'procurement_manager' where id = '55555555-5555-5555-5555-555555550259';
-- fourth user stays visitor

insert into public.projects (id, code, name) values
  ('cc000259-0000-4000-8000-000000000001', 'TAP-VOID', 'void-PO fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000259-0000-4000-8000-000000000001',
   'cc000259-0000-4000-8000-000000000001', 'WP-VOID-1', 'void WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000259-0000-4000-8000-000000000001', 'ร้านทดสอบ ยกเลิก',
   '11111111-1111-1111-1111-111111110259');

-- pr1/pr2: approved, WP-bound — the "mistaken PO" happy-path pair.
-- pr3: approved, standalone — bundled into its OWN po to prove the shipped
--      guard (record_shipment moves it to on_route before the void attempt).
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status,
     source, requested_by) values
  ('fa000259-0000-4000-8000-000000000001',
   'ee000259-0000-4000-8000-000000000001', 'ปูนซีเมนต์', 10, 'ถุง', 'approved',
   'app', '11111111-1111-1111-1111-111111110259'),
  ('fa000259-0000-4000-8000-000000000002',
   'ee000259-0000-4000-8000-000000000001', 'เหล็กเส้น', 5, 'เส้น', 'approved',
   'app', '11111111-1111-1111-1111-111111110259'),
  ('fa000259-0000-4000-8000-000000000003',
   'ee000259-0000-4000-8000-000000000001', 'ทราย', 3, 'คิว', 'approved',
   'app', '11111111-1111-1111-1111-111111110259'),
  -- pr4: approved, WP-bound — spec 260: bundled into its own PO-C with a
  -- transport charge, to prove void_purchase_order reverses/cascades charges.
  ('fa000259-0000-4000-8000-000000000004',
   'ee000259-0000-4000-8000-000000000001', 'ค่าขนส่งทดสอบ', 1, 'งาน', 'approved',
   'app', '11111111-1111-1111-1111-111111110259');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Structure.
-- ============================================================================
select ok(to_regprocedure('public.void_purchase_order(uuid)') is not null,
  'void_purchase_order exists');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'void_purchase_order'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  1, 'void_purchase_order is SECURITY DEFINER with pinned search_path');
select is(has_function_privilege('anon',
  'public.void_purchase_order(uuid)', 'EXECUTE'), false,
  'anon cannot execute void_purchase_order');
select ok(has_function_privilege('authenticated',
  'public.void_purchase_order(uuid)', 'EXECUTE'),
  'authenticated may execute void_purchase_order');

-- ============================================================================
-- B. Build PO-A (pr1 + pr2, VAT-free) as project_manager — the mistaken order.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110259"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000259-0000-4000-8000-000000000001'::uuid, date '2026-07-20',
       '[{"request_id":"fa000259-0000-4000-8000-000000000001","amount":100},
         {"request_id":"fa000259-0000-4000-8000-000000000002","amount":200}]'::jsonb) $$,
  'PM creates PO-A bundling pr1 + pr2 (the mistake)');
reset role;

-- Simulate the drain having ALREADY posted pr1's purchase (Dr 1400 / Cr 2100),
-- same as 216-divert-purchase-to-store's setup — proves void reverses a real
-- posted entry, not just an untouched pending job.
select public.post_purchase_to_gl('fa000259-0000-4000-8000-000000000001');

select is(
  (select coalesce(sum(l.debit - l.credit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code = '1400')
      and l.work_package_id = 'ee000259-0000-4000-8000-000000000001'),
  100::numeric, 'pre-void: WP-WIP (1400) = 100 (pr1''s purchase posted)');

-- pr2's job never drained — still sitting 'pending'.
select is(
  (select status::text from public.gl_posting_outbox
    where source_table = 'purchase_requests'
      and source_id = 'fa000259-0000-4000-8000-000000000002'
      and source_event = 'purchase'),
  'pending', 'pre-void: pr2''s purchase job is still pending (never drained)');

-- ============================================================================
-- C. Guards: role gate + 404 + the shipped-line guard.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220259"}';
select throws_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
          where id = 'fa000259-0000-4000-8000-000000000001')) $$,
  '42501', null, 'void_purchase_order refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330259"}';
select throws_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
          where id = 'fa000259-0000-4000-8000-000000000001')) $$,
  '42501', null, 'void_purchase_order refuses visitor');

-- Spec 261 / ADR 0070 item 1: void is now MANAGER-ONLY — plain procurement,
-- which spec 259 originally admitted, is REMOVED (deliberate walk-back).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440259"}';
select throws_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
          where id = 'fa000259-0000-4000-8000-000000000001')) $$,
  '42501', null, 'void_purchase_order refuses plain procurement (spec 261 item 1)');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110259"}';
select throws_ok(
  $$ select public.void_purchase_order('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'PO404', null, 'void_purchase_order refuses an unknown PO id (spec 269: distinct errcode PO404)');

-- Build PO-B around pr3 alone, ship it, then prove a shipped PO cannot void.
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000259-0000-4000-8000-000000000001'::uuid, date '2026-07-20',
       '[{"request_id":"fa000259-0000-4000-8000-000000000003","amount":50}]'::jsonb) $$,
  'PM creates PO-B around pr3');
select public.record_shipment('fa000259-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
          where id = 'fa000259-0000-4000-8000-000000000003')) $$,
  'PO409', null,
  'void_purchase_order refuses a PO with a shipped (on_route) member (spec 269: distinct errcode PO409)');
reset role;

-- ============================================================================
-- D. Happy path: procurement_manager voids PO-A (spec 261 item 1 — the void
--    moved from the whole create-audience to the manager tier).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550259"}';
select lives_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
          where id = 'fa000259-0000-4000-8000-000000000001')) $$,
  'procurement_manager voids PO-A');
reset role;

-- E. Both members are back to exactly their pre-purchase shape.
select is(
  (select status::text from public.purchase_requests
    where id = 'fa000259-0000-4000-8000-000000000001'),
  'approved', 'pr1 back to approved');
select ok(
  (select purchase_order_id is null and delivery_id is null and supplier is null
      and supplier_id is null and amount is null and eta is null
      and purchased_at is null
     from public.purchase_requests
    where id = 'fa000259-0000-4000-8000-000000000001'),
  'pr1: every purchase-time fact nulled');
select is(
  (select status::text from public.purchase_requests
    where id = 'fa000259-0000-4000-8000-000000000002'),
  'approved', 'pr2 back to approved too');

-- F. The PO row (and its cascaded default delivery) is gone.
select ok(
  not exists (
    select 1 from public.purchase_orders
     where id in (
       select target_id from public.audit_log
        where action = 'purchase_order_void'
          and payload -> 'request_ids' ? 'fa000259-0000-4000-8000-000000000001')),
  'the voided PO row no longer exists');
select is(
  (select count(*)::int from public.purchase_order_deliveries
    where purchase_order_id = (
      select target_id from public.audit_log
       where action = 'purchase_order_void'
         and payload -> 'request_ids' ? 'fa000259-0000-4000-8000-000000000001')),
  0, 'the voided PO''s default delivery cascaded away too');

-- G. GL safety: the posted pr1 entry is reversed (WIP nets to 0); pr2's
--    pending job is 'skipped', never postable after the fact.
select is(
  (select coalesce(sum(l.debit - l.credit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code = '1400')
      and l.work_package_id = 'ee000259-0000-4000-8000-000000000001'),
  0::numeric, 'post-void: WP-WIP (1400) nets to 0 (pr1''s entry reversed)');
select is(
  (select status::text from public.gl_posting_outbox
    where source_table = 'purchase_requests'
      and source_id = 'fa000259-0000-4000-8000-000000000002'
      and source_event = 'purchase'),
  'skipped', 'post-void: pr2''s pending job is skipped, will never post');

-- H. Audit row shape.
select is(
  (select count(*)::int from public.audit_log
    where action = 'purchase_order_void'
      and payload->>'po_number' is not null
      and payload -> 'request_ids' ? 'fa000259-0000-4000-8000-000000000001'
      and payload -> 'request_ids' ? 'fa000259-0000-4000-8000-000000000002'),
  1, 'one purchase_order_void audit row naming both reverted request ids');

-- I. Acceptance criterion: pr1 is free to be bundled into a brand-new,
--    CORRECT PO — the entire point of "revert while retaining PR items".
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110259"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000259-0000-4000-8000-000000000001'::uuid, date '2026-07-22',
       '[{"request_id":"fa000259-0000-4000-8000-000000000001","amount":90}]'::jsonb) $$,
  'the reverted pr1 can be bundled into a fresh, correct PO');
reset role;
select is(
  (select amount from public.purchase_requests
    where id = 'fa000259-0000-4000-8000-000000000001'),
  90::numeric, 'pr1 now carries the CORRECT PO''s amount');

-- ============================================================================
-- J. Spec 260 — void_purchase_order additionally reverses/cascades a PO's
--    charges. Build PO-C around pr4, add a transport charge, post it to GL,
--    then void the whole PO: the charge entry reverses (WIP nets to 0) and the
--    charge row cascades away with the PO.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110259"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000259-0000-4000-8000-000000000001'::uuid, date '2026-07-25',
       '[{"request_id":"fa000259-0000-4000-8000-000000000004","amount":40}]'::jsonb) $$,
  'PM creates PO-C around pr4');
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000259-0000-4000-8000-000000000004'),
       'transport', 30, 0, null) $$,
  'PM adds a transport charge to PO-C');
reset role;
-- Post the charge (its share Dr 1400 = 30 against pr4's WP).
select public.post_purchase_order_charge_to_gl(
  (select id from public.purchase_order_charges
    where purchase_order_id = (select purchase_order_id from public.purchase_requests
                                where id = 'fa000259-0000-4000-8000-000000000004')));

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110259"}';
select lives_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000259-0000-4000-8000-000000000004')) $$,
  'PM voids PO-C (which carries a posted charge)');
reset role;
-- Charge row cascaded (scoped to the fixture creator — data-independent).
select is(
  (select count(*)::int from public.purchase_order_charges
    where created_by = '11111111-1111-1111-1111-111111110259'),
  0, 'void: PO-C''s charge row cascaded away with the PO');
-- The posted charge entry (Dr 1400 = 30 against pr4's WP) reversed → WP-WIP
-- nets back to 0 (pr1's entry was already reversed in section G, so the WP's
-- only remaining posting was PO-C's charge).
select is(
  (select coalesce(sum(l.debit - l.credit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code = '1400')
      and l.work_package_id = 'ee000259-0000-4000-8000-000000000001'),
  0::numeric, 'void: the charge''s WIP posting reversed (WP-WIP nets to 0)');

-- ============================================================================
-- K. Spec 269 — a PO WITH ATTACHMENTS voids clean (the case the original
--    tests missed — live incident PO-4073). The attachments append-only
--    trigger must admit the PO-delete's ON DELETE CASCADE (parent row already
--    gone within the statement) while still blocking every direct write, and
--    the void audit payload must snapshot the deleted rows.
-- ============================================================================
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status,
     source, requested_by) values
  ('fa000259-0000-4000-8000-000000000005',
   'ee000259-0000-4000-8000-000000000001', 'ปูนกาว', 2, 'ถุง', 'approved',
   'app', '11111111-1111-1111-1111-111111110259');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110259"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000259-0000-4000-8000-000000000001'::uuid, date '2026-07-27',
       '[{"request_id":"fa000259-0000-4000-8000-000000000005","amount":60}]'::jsonb) $$,
  'PM creates PO-D around pr5 (will carry attachments)');
reset role;

-- PO-D gets the real-world attachment shapes: a source document, a
-- proof-of-delivery bound to the PO's default delivery, and a superseded
-- content+tombstone pair. Plus one SURVIVOR attachment on PO-B (which lives
-- on shipped) to prove direct writes stay blocked and bystanders are safe.
insert into public.purchase_order_attachments (id, purchase_order_id, kind, purpose, storage_path, created_by)
  select 'ad000259-0000-4000-8000-000000000001', purchase_order_id, 'image',
         'source_document', 'spec269/k1.jpg', '11111111-1111-1111-1111-111111110259'
    from public.purchase_requests where id = 'fa000259-0000-4000-8000-000000000005';
insert into public.purchase_order_attachments (purchase_order_id, delivery_id, kind, purpose, storage_path, created_by)
  select pr.purchase_order_id, d.id, 'pdf',
         'proof_of_delivery', 'spec269/k2.pdf', '11111111-1111-1111-1111-111111110259'
    from public.purchase_requests pr
    join public.purchase_order_deliveries d on d.purchase_order_id = pr.purchase_order_id
   where pr.id = 'fa000259-0000-4000-8000-000000000005';
insert into public.purchase_order_attachments (id, purchase_order_id, kind, purpose, storage_path, created_by)
  select 'ad000259-0000-4000-8000-000000000003', purchase_order_id, 'image',
         'source_document', 'spec269/k3.jpg', '11111111-1111-1111-1111-111111110259'
    from public.purchase_requests where id = 'fa000259-0000-4000-8000-000000000005';
insert into public.purchase_order_attachments (purchase_order_id, kind, purpose, superseded_by, created_by)
  select purchase_order_id, 'image', 'source_document',
         'ad000259-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111110259'
    from public.purchase_requests where id = 'fa000259-0000-4000-8000-000000000005';
insert into public.purchase_order_attachments (id, purchase_order_id, kind, purpose, storage_path, created_by)
  select 'ad000259-0000-4000-8000-000000000009', purchase_order_id, 'image',
         'source_document', 'spec269/survivor.jpg', '11111111-1111-1111-1111-111111110259'
    from public.purchase_requests where id = 'fa000259-0000-4000-8000-000000000003';

-- Direct writes stay blocked even for the table owner (trigger layer, not
-- grants): parent PO-B is alive, so the spec 269 carve-out must NOT open.
select throws_ok(
  $$ delete from public.purchase_order_attachments
      where id = 'ad000259-0000-4000-8000-000000000009' $$,
  'P0001', null,
  'direct DELETE of an attachment (parent PO alive) still raises P0001');
select throws_ok(
  $$ update public.purchase_order_attachments
        set storage_path = 'spec269/hacked.jpg'
      where id = 'ad000259-0000-4000-8000-000000000009' $$,
  'P0001', null,
  'direct UPDATE of an attachment still raises P0001');

-- THE regression: voiding a PO that has attachment rows succeeds.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550259"}';
select lives_ok(
  $$ select public.void_purchase_order(
       (select purchase_order_id from public.purchase_requests
          where id = 'fa000259-0000-4000-8000-000000000005')) $$,
  'procurement_manager voids PO-D although it carries 4 attachment rows (spec 269)');
reset role;

-- All four PO-D attachment rows cascaded away; the PO-B survivor is untouched.
select is(
  (select count(*)::int from public.purchase_order_attachments
    where storage_path in ('spec269/k1.jpg', 'spec269/k2.pdf', 'spec269/k3.jpg')
       or superseded_by = 'ad000259-0000-4000-8000-000000000003'),
  0, 'all PO-D attachment rows (incl. the tombstone) cascaded away with the void');

-- History preserved: the void audit payload snapshots all 4 rows.
select is(
  (select jsonb_array_length(payload->'attachments') from public.audit_log
    where action = 'purchase_order_void'
      and payload -> 'request_ids' ? 'fa000259-0000-4000-8000-000000000005'),
  4, 'void audit payload snapshots all 4 attachment rows');
select ok(
  (select payload->'attachments' @> '[{"storage_path":"spec269/k1.jpg"}]'::jsonb
     from public.audit_log
    where action = 'purchase_order_void'
      and payload -> 'request_ids' ? 'fa000259-0000-4000-8000-000000000005'),
  'the snapshot retains the storage paths (orphaned bucket objects stay recoverable)');

select * from finish();
rollback;
