begin;
select plan(51);

-- ============================================================================
-- A. Setup as postgres (bypasses RLS).
--    Reuse some UUIDs from 17-purchase-requests.test.sql as fixtures;
--    each test file rolls back, so no cross-file state.
--
--    Six auth users → five promoted roles; one work_package; five
--    purchase_request fixtures covering each lifecycle status.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000001-0000-0000-0000-000000000001', 'super@aw-test.local',  '{}'::jsonb),
  ('a0000001-0000-0000-0000-000000000002', 'pm@aw-test.local',     '{}'::jsonb),
  ('a0000001-0000-0000-0000-000000000003', 'sa@aw-test.local',     '{}'::jsonb),
  ('a0000001-0000-0000-0000-000000000004', 'proc@aw-test.local',   '{}'::jsonb),
  ('a0000001-0000-0000-0000-000000000005', 'visitor@aw-test.local','{}'::jsonb),
  ('a0000001-0000-0000-0000-000000000006', 'pm2@aw-test.local',    '{}'::jsonb);

update public.users set role = 'super_admin'      where id = 'a0000001-0000-0000-0000-000000000001';
update public.users set role = 'project_manager'  where id = 'a0000001-0000-0000-0000-000000000002';
update public.users set role = 'site_admin'       where id = 'a0000001-0000-0000-0000-000000000003';
update public.users set role = 'procurement'      where id = 'a0000001-0000-0000-0000-000000000004';
-- 000000000005 stays visitor (trigger default)
update public.users set role = 'project_manager'  where id = 'a0000001-0000-0000-0000-000000000006';

insert into public.projects (id, code, name) values
  ('b0000001-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PRC-TEST-AW', 'AppSheet writer test project');

insert into public.work_packages (id, project_id, code, name) values
  ('c0000001-cccc-cccc-cccc-cccccccccccc',
   'b0000001-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'WP-AW-01', 'AppSheet writer test WP');

-- Five PR fixtures: one per status, so SELECT visibility tests are precise.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status)
values
  -- d1: requested (visible to appsheet_writer)
  ('d1000001-dddd-dddd-dddd-dddddddddddd',
   'c0000001-cccc-cccc-cccc-cccccccccccc',
   'Cement bag 50kg', 10, 'bag',
   'a0000001-0000-0000-0000-000000000003',
   'requested'),
  -- d2: rejected (NOT visible to appsheet_writer)
  ('d2000001-dddd-dddd-dddd-dddddddddddd',
   'c0000001-cccc-cccc-cccc-cccccccccccc',
   'Rebar rejected', 5, 'rod',
   'a0000001-0000-0000-0000-000000000003',
   'rejected');

-- d3: approved — visible, and the happy-path approved→purchased UPDATE fixture.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at)
values
  ('d3000001-dddd-dddd-dddd-dddddddddddd',
   'c0000001-cccc-cccc-cccc-cccccccccccc',
   'Steel bar', 20, 'rod',
   'a0000001-0000-0000-0000-000000000003',
   'approved',
   'a0000001-0000-0000-0000-000000000002',
   now());

-- d4: purchased — visible, and the happy-path purchased→delivered UPDATE fixture.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at,
   supplier, order_ref, amount, purchased_at)
values
  ('d4000001-dddd-dddd-dddd-dddddddddddd',
   'c0000001-cccc-cccc-cccc-cccccccccccc',
   'Plywood 12mm', 15, 'sheet',
   'a0000001-0000-0000-0000-000000000003',
   'purchased',
   'a0000001-0000-0000-0000-000000000002',
   now() - interval '1 day',
   'ABC Hardware', 'PO-2026-001', 4500.00, now() - interval '1 hour');

-- d5: delivered — visible.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at,
   supplier, order_ref, amount, purchased_at,
   delivered_at, received_by, delivery_note)
values
  ('d5000001-dddd-dddd-dddd-dddddddddddd',
   'c0000001-cccc-cccc-cccc-cccccccccccc',
   'Paint white', 50, 'litre',
   'a0000001-0000-0000-0000-000000000003',
   'delivered',
   'a0000001-0000-0000-0000-000000000002',
   now() - interval '3 days',
   'XYZ Supplies', 'PO-2026-002', 2200.00, now() - interval '2 days',
   now() - interval '1 day', 'Site Foreman A', 'Delivered on site, no damage');

-- d6: approved — a second approved row for the field-correction test (L.3),
-- so d3 is not mutated mid-test.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at, amount)
values
  ('d6000001-dddd-dddd-dddd-dddddddddddd',
   'c0000001-cccc-cccc-cccc-cccccccccccc',
   'Nails 4in', 500, 'piece',
   'a0000001-0000-0000-0000-000000000003',
   'approved',
   'a0000001-0000-0000-0000-000000000002',
   now(), 8000.00);

-- Grant the runner's temp result buffer to appsheet_writer so SET SESSION AUTHORIZATION
-- sections can record TAP output via the runner's _tap_buf rewrite.
grant insert  on _tap_buf to appsheet_writer;
grant select  on _tap_buf to appsheet_writer;
grant usage   on sequence _tap_buf_ord_seq to appsheet_writer;

-- ============================================================================
-- B. Catalog: role properties, grants, enum values.
-- ============================================================================

-- B.1 Role exists.
select has_role('appsheet_writer', 'role appsheet_writer exists');

-- B.2 noinherit.
select is(
  (select rolname from pg_roles where rolname = 'appsheet_writer' and not rolinherit),
  'appsheet_writer',
  'appsheet_writer is NOINHERIT'
);

-- B.3 Not BYPASSRLS.
select is(
  (select rolname from pg_roles where rolname = 'appsheet_writer' and not rolbypassrls),
  'appsheet_writer',
  'appsheet_writer is NOT BYPASSRLS'
);

-- B.4 SELECT grant present.
select table_privs_are(
  'public', 'purchase_requests', 'appsheet_writer',
  array['SELECT'],
  'appsheet_writer has SELECT on purchase_requests (no INSERT, no DELETE)'
);

-- B.5 Column-scoped UPDATE grant present on each of the 7 permitted columns.
--     col_privs_are uses has_column_privilege(), which includes inherited
--     table-level grants. appsheet_writer has table-level SELECT, so each
--     column shows SELECT too. Expect ['SELECT','UPDATE'] for the 7 columns.
select col_privs_are(
  'public', 'purchase_requests', 'supplier',      'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on supplier');
select col_privs_are(
  'public', 'purchase_requests', 'order_ref',     'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on order_ref');
select col_privs_are(
  'public', 'purchase_requests', 'amount',        'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on amount');
select col_privs_are(
  'public', 'purchase_requests', 'purchased_at',  'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on purchased_at');
select col_privs_are(
  'public', 'purchase_requests', 'delivered_at',  'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on delivered_at');
select col_privs_are(
  'public', 'purchase_requests', 'received_by',   'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on received_by');
select col_privs_are(
  'public', 'purchase_requests', 'delivery_note', 'appsheet_writer', array['SELECT','UPDATE'], 'SELECT+UPDATE on delivery_note');

-- B.6 Protected columns have only SELECT (inherited from table-level grant),
--     no UPDATE. Confirms the column-scoped UPDATE grant is narrow.
select col_privs_are(
  'public', 'purchase_requests', 'status',          'appsheet_writer', array['SELECT'], 'SELECT only on status — no UPDATE');
select col_privs_are(
  'public', 'purchase_requests', 'source',          'appsheet_writer', array['SELECT'], 'SELECT only on source — no UPDATE');
select col_privs_are(
  'public', 'purchase_requests', 'item_description','appsheet_writer', array['SELECT'], 'SELECT only on item_description — no UPDATE');
select col_privs_are(
  'public', 'purchase_requests', 'requested_by',    'appsheet_writer', array['SELECT'], 'SELECT only on requested_by — no UPDATE');

-- B.7 New audit enum values exist.
select enum_has_labels(
  'public', 'audit_action',
  array[
    'insert', 'update', 'delete', 'login', 'logout', 'role_change',
    'photo_upload', 'photo_supersede', 'approve', 'reject', 'export', 'other',
    'profile_update', 'purchase_request_decision',
    'purchase_request_purchase', 'purchase_request_delivery'
  ],
  'audit_action enum includes purchase_request_purchase + purchase_request_delivery'
);

-- B.8 Both new trigger functions exist.
select has_function('public', 'purchase_requests_derive_appsheet_status',
  'purchase_requests_derive_appsheet_status trigger function exists');
select has_function('public', 'purchase_requests_audit_appsheet',
  'purchase_requests_audit_appsheet trigger function exists');

-- B.9 Both triggers exist on purchase_requests.
select has_trigger('public', 'purchase_requests', 'purchase_requests_derive_appsheet_status',
  'BEFORE UPDATE derive/guard trigger exists on purchase_requests');
select has_trigger('public', 'purchase_requests', 'purchase_requests_audit_appsheet',
  'AFTER UPDATE audit trigger exists on purchase_requests');

-- ============================================================================
-- C. SELECT visibility under appsheet_writer (status-gated worklist).
--    Approved / purchased / delivered → visible.
--    Requested / rejected → NOT visible.
-- ============================================================================

set local session authorization appsheet_writer;

-- C.1 Approved row is visible.
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'appsheet_writer SELECTs approved row (procurement worklist)'
);

-- C.2 Purchased row is visible.
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'appsheet_writer SELECTs purchased row (procurement worklist)'
);

-- C.3 Delivered row is visible.
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd5000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'appsheet_writer SELECTs delivered row (procurement worklist)'
);

-- C.4 Requested row is NOT visible.
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd1000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'appsheet_writer does NOT see requested row (worklist gate)'
);

-- C.5 Rejected row is NOT visible.
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd2000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'appsheet_writer does NOT see rejected row (worklist gate)'
);

-- ============================================================================
-- D. Privilege denials under appsheet_writer.
-- ============================================================================

-- D.1 Direct UPDATE on status is denied (42501 — not in the column grant).
select throws_ok(
  $$ update public.purchase_requests
       set status = 'purchased'
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  '42501',
  null,
  'UPDATE status directly is denied by column-scoped grant (42501)'
);

-- D.2 UPDATE item_description is denied.
select throws_ok(
  $$ update public.purchase_requests
       set item_description = 'tampered'
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  '42501',
  null,
  'UPDATE item_description is denied by column-scoped grant (42501)'
);

-- D.3 UPDATE source is denied.
select throws_ok(
  $$ update public.purchase_requests
       set source = 'app'
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  '42501',
  null,
  'UPDATE source is denied by column-scoped grant (42501)'
);

-- D.4 INSERT is denied.
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit,
        source, requested_by_email)
     values ('c0000001-cccc-cccc-cccc-cccccccccccc'::uuid,
             'Test item', 1, 'each', 'appsheet', 'test@example.com') $$,
  '42501',
  null,
  'INSERT is denied for appsheet_writer (INSERT deferred; no INSERT grant)'
);

-- ============================================================================
-- E. Happy-path UPDATE: derive/guard trigger advances status.
-- ============================================================================

-- E.1 approved → purchased: set supplier, order_ref, amount, purchased_at
--     on d3 (currently 'approved') ⇒ BEFORE trigger sets status = 'purchased'.
select lives_ok(
  $$ update public.purchase_requests
       set supplier     = 'Test Supplier Ltd',
           order_ref    = 'PO-9999',
           amount       = 12500.00,
           purchased_at = now()
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'approved→purchased happy path: UPDATE on d3 lives'
);

set local session authorization default;

select is(
  (select status::text from public.purchase_requests
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  'purchased',
  'derive trigger advanced status approved→purchased on d3'
);

-- E.2 purchased → delivered: set delivered_at, received_by, delivery_note
--     on d4 (currently 'purchased') ⇒ BEFORE trigger sets status = 'delivered'.
set local session authorization appsheet_writer;

select lives_ok(
  $$ update public.purchase_requests
       set delivered_at  = now(),
           received_by   = 'Site Foreman B',
           delivery_note = 'Received in full'
     where id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'purchased→delivered happy path: UPDATE on d4 lives'
);

set local session authorization default;

select is(
  (select status::text from public.purchase_requests
     where id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  'delivered',
  'derive trigger advanced status purchased→delivered on d4'
);

-- ============================================================================
-- F. Derive/guard trigger: illegal move rejections.
-- ============================================================================

set local session authorization appsheet_writer;

-- F.1 Setting delivered_at on an approved row (status='approved') is illegal:
--     must go purchased first.
select throws_ok(
  $$ update public.purchase_requests
       set delivered_at = now()
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'P0001',
  null,
  'setting delivered_at on an approved row is rejected by derive trigger (P0001)'
);

-- F.2 Setting purchased_at on a requested row is not visible (RLS gate
--     hides requested rows) — the UPDATE silently affects 0 rows.
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd1000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'requested row not visible to appsheet_writer — purchased_at set attempt is a no-op'
);

-- F.3 Single UPDATE setting BOTH purchased_at AND delivered_at on an approved row raises
--     P0001: the delivered_at guard fires first (OLD.status='approved' <> 'purchased'),
--     preventing a skip from approved → delivered in one statement.
select throws_ok(
  $$ update public.purchase_requests
       set purchased_at = now(),
           delivered_at = now()
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'P0001',
  null,
  'single UPDATE with purchased_at + delivered_at on approved row raises P0001 (delivered_at guard fires first)'
);

-- ============================================================================
-- G. Permissive-OR: AppSheet UPDATE succeeds even though the native TO-PUBLIC
--    UPDATE policy returns false for this role (current_user_role() = NULL).
--    Verified implicitly by E.1 and E.2 living — if only the native policy
--    applied, those UPDATEs would have silently affected 0 rows.
--    Add an explicit count check for belt-and-braces.
-- ============================================================================

-- G.1 d6 (approved) is visible to appsheet_writer (approved is on the worklist).
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'appsheet_writer sees approved row d6 — TO appsheet_writer UPDATE policy is active'
);

set local session authorization default;

-- ============================================================================
-- H. Audit: trigger writes correct rows for each transition.
-- ============================================================================

-- H.1 approved→purchased (d3, transitioned in E.1) → one purchase_request_purchase row.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_purchase'
       and target_table = 'purchase_requests'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'exactly one purchase_request_purchase audit row written for approved→purchased (d3)'
);

-- H.2 actor_id and actor_role are NULL (no auth user; no JWT claims under SET SESSION AUTHORIZATION).
select is(
  (select actor_id from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::uuid,
  'actor_id is NULL for appsheet_writer audit row (no auth.uid())'
);

select is(
  (select actor_role from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::public.user_role,
  'actor_role is NULL for appsheet_writer audit row (no current_user_role())'
);

-- H.3 Payload principal is 'appsheet_writer' (session_user captured by the trigger).
select is(
  (select payload->>'principal' from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  'appsheet_writer',
  'payload->principal is ''appsheet_writer'' (session_user captured under SECURITY DEFINER)'
);

-- H.4 purchased→delivered (d4, transitioned in E.2) → one purchase_request_delivery row.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_delivery'
       and target_table = 'purchase_requests'
       and target_id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'exactly one purchase_request_delivery audit row written for purchased→delivered (d4)'
);

-- H.5 Field correction on d6 (amount changed, status stays 'approved')
--     → one 'update' audit row with a diff payload.
set local session authorization appsheet_writer;

select lives_ok(
  $$ update public.purchase_requests
       set amount = 9000.00
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'field-correction UPDATE on approved row (amount change) lives'
);

set local session authorization default;

select is(
  (select count(*)::int from public.audit_log
     where action = 'update'
       and target_table = 'purchase_requests'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'exactly one update audit row written for amount field-correction on d6'
);

select is(
  (select payload->'changed' is not null from public.audit_log
     where action = 'update'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  true,
  'field-correction audit payload contains ''changed'' diff object'
);

-- H.6 P1b decision trigger did NOT fire on AppSheet transitions — no
--     purchase_request_decision rows for d3 or d4 (both were 'approved'
--     and 'purchased' before appsheet_writer touched them; the P1b WHEN
--     clause requires OLD.status = 'requested').
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_decision'
       and target_id in (
         'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid,
         'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid
       )),
  0,
  'P1b decision trigger did NOT fire on AppSheet transitions (no double-audit)'
);

-- H.7 No-op UPDATE (fact-column value set to its existing value) writes ZERO audit rows.
--     Confirms the tightened WHEN clause prevents the trigger from firing on true no-ops;
--     even under the old broad WHEN, the v_changed='{}' guard would skip the INSERT.
set local session authorization appsheet_writer;

select lives_ok(
  $$ update public.purchase_requests
       set supplier = 'XYZ Supplies'
     where id = 'd5000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'no-op UPDATE (supplier unchanged on d5) lives under appsheet_writer'
);

set local session authorization default;

select is(
  (select count(*)::int from public.audit_log
     where target_table = 'purchase_requests'
       and target_id = 'd5000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'no-op UPDATE on d5 (delivered) writes ZERO audit rows — tightened WHEN + v_changed guard'
);

-- ============================================================================
-- I. Negative isolation: native PM decision flow unaffected.
--    PM transitions d1 (requested → approved) via the authenticated role —
--    writes exactly one purchase_request_decision row and nothing else.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a0000001-0000-0000-0000-000000000002"}';

select lives_ok(
  $$ update public.purchase_requests
       set status      = 'approved',
           approved_by = 'a0000001-0000-0000-0000-000000000002'::uuid,
           decided_at  = now()
     where id = 'd1000001-dddd-dddd-dddd-dddddddddddd'::uuid
       and status = 'requested' $$,
  'PM native decision (requested → approved) lives'
);

reset role;

select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_decision'
       and target_id = 'd1000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'native PM decision writes exactly one purchase_request_decision row'
);

select is(
  (select count(*)::int from public.audit_log
     where action != 'purchase_request_decision'
       and target_id = 'd1000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'native PM decision writes ONLY a purchase_request_decision row — no other audit entries'
);

-- ============================================================================
-- J. Tear down.
-- ============================================================================

reset role;

select * from finish();
rollback;
