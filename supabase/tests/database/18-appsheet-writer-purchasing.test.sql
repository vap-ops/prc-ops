begin;
select plan(52);

-- ============================================================================
-- A. Setup (as postgres / BYPASSRLS).
--    Four PR fixtures span the procurement lifecycle.  No role-switching in this
--    file — triggers fire for any role, so postgres drives all UPDATEs.
--
--    Two-tier testing doctrine (ADR 0025 § Testing note):
--      Tier 1 (this file, pgTAP as postgres): trigger logic, grant matrix, and
--        RLS policy quals via pg_policies.
--      Tier 2 (out-of-band smoke under a real appsheet_writer login, once at
--        enablement): RLS row-visibility effect, privilege 42501s, and principal
--        capture (payload->>'principal' = 'appsheet_writer').
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000001-0000-0000-0000-000000000002', 'pm@aw-test.local', '{}'::jsonb),
  ('a0000001-0000-0000-0000-000000000003', 'sa@aw-test.local', '{}'::jsonb);

insert into public.projects (id, code, name) values
  ('b0000001-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PRC-TEST-AW', 'AppSheet writer test project');

insert into public.work_packages (id, project_id, code, name) values
  ('c0000001-cccc-cccc-cccc-cccccccccccc',
   'b0000001-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'WP-AW-01', 'AppSheet writer test WP');

-- d3: approved — the approved→purchased transition fixture.
--     purchased_at IS NULL initially; setting it triggers the derive transition.
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

-- d4: purchased — the purchased→delivered transition fixture.
--     delivered_at IS NULL initially; setting it triggers the derive transition.
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

-- d5: delivered — the no-op UPDATE fixture (H.7).
--     supplier = 'XYZ Supplies'; the no-op test sets it to the same value so
--     old.supplier IS DISTINCT FROM new.supplier = false → WHEN clause skips.
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

-- d6: approved — illegal-move guard tests (C.5, C.6) and field-correction audit
--     test (D.9-D.14).  A second approved row so d3 is not mutated before C section.
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

-- ============================================================================
-- B. Catalog: role properties, table/column grants, trigger existence, and RLS
--    policy qual regression guard.  All 23 assertions run as postgres.
-- ============================================================================

-- B.1 Role exists.
select has_role('appsheet_writer', 'role appsheet_writer exists');

-- B.2 NOINHERIT — no inherited privileges from other roles.
select is(
  (select rolname from pg_roles where rolname = 'appsheet_writer' and not rolinherit),
  'appsheet_writer',
  'appsheet_writer is NOINHERIT'
);

-- B.3 Not BYPASSRLS — locked invariant (ADR 0018).
select is(
  (select rolname from pg_roles where rolname = 'appsheet_writer' and not rolbypassrls),
  'appsheet_writer',
  'appsheet_writer is NOT BYPASSRLS'
);

-- B.4 Table-level privilege spot-checks.
select is(has_table_privilege('appsheet_writer', 'public.purchase_requests', 'SELECT'),
  true,  'appsheet_writer has table-level SELECT on purchase_requests');
select is(has_table_privilege('appsheet_writer', 'public.purchase_requests', 'INSERT'),
  false, 'appsheet_writer has NO table-level INSERT on purchase_requests (deferred)');
select is(has_table_privilege('appsheet_writer', 'public.purchase_requests', 'DELETE'),
  false, 'appsheet_writer has NO table-level DELETE on purchase_requests');

-- B.5 Column-scoped UPDATE grant: TRUE for the 7 permitted fact columns.
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'supplier',      'UPDATE'), true, 'appsheet_writer has UPDATE on supplier');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'order_ref',     'UPDATE'), true, 'appsheet_writer has UPDATE on order_ref');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'amount',        'UPDATE'), true, 'appsheet_writer has UPDATE on amount');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'purchased_at',  'UPDATE'), true, 'appsheet_writer has UPDATE on purchased_at');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'delivered_at',  'UPDATE'), true, 'appsheet_writer has UPDATE on delivered_at');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'received_by',   'UPDATE'), true, 'appsheet_writer has UPDATE on received_by');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'delivery_note', 'UPDATE'), true, 'appsheet_writer has UPDATE on delivery_note');
-- 8th fact column since spec 16 P1 (ADR 0026, migration 20260613100100).
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'eta',           'UPDATE'), true, 'appsheet_writer has UPDATE on eta (ADR 0026)');

-- B.6 Column-scoped UPDATE grant: FALSE for protected columns (spot-check).
--     These three are the privilege-layer guarantee that AppSheet cannot alter
--     workflow metadata even with a direct DB connection.
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'status',           'UPDATE'), false, 'appsheet_writer has NO UPDATE on status (privilege-layer guarantee)');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'source',           'UPDATE'), false, 'appsheet_writer has NO UPDATE on source');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'item_description', 'UPDATE'), false, 'appsheet_writer has NO UPDATE on item_description');
-- Requester-set spec-16 columns — protected set grows to 5 (ADR 0026).
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'needed_by',        'UPDATE'), false, 'appsheet_writer has NO UPDATE on needed_by (requester column, ADR 0026)');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'priority',         'UPDATE'), false, 'appsheet_writer has NO UPDATE on priority (requester column, ADR 0026)');

-- Silent-audit-gap regression guards (spec 16 §7): both hard-coded column
-- lists — the function's case-3 diff body AND the trigger's WHEN clause —
-- must name eta, or eta-only corrections silently stop being audited.
select ok(
  pg_get_functiondef('public.purchase_requests_audit_appsheet()'::regprocedure)
    like '%new.eta%',
  'audit function diff body names eta (8th branch, ADR 0026)'
);
select ok(
  (select pg_get_triggerdef(oid) from pg_trigger
     where tgname = 'purchase_requests_audit_appsheet'
       and tgrelid = 'public.purchase_requests'::regclass)
    like '%eta%',
  'audit trigger WHEN clause names eta (8th predicate, ADR 0026)'
);

-- B.7 New audit enum values exist (full label set — spec 46 added
-- worker_change).
select enum_has_labels(
  'public', 'audit_action',
  array[
    'insert', 'update', 'delete', 'login', 'logout', 'role_change',
    'photo_upload', 'photo_supersede', 'approve', 'reject', 'export', 'other',
    'profile_update', 'purchase_request_decision',
    'purchase_request_purchase', 'purchase_request_delivery', 'worker_change',
    'labor_cost_freeze', 'purchase_order_create', 'dc_payment_recorded',
    'equipment_rate_change', 'equipment_batch_create',
    'equipment_allocation_create', 'gl_account_upsert',
    'accounting_period_open', 'accounting_period_status_change',
    'journal_posted', 'client_billing_create', 'client_billing_certify'
  ],
  'audit_action enum includes purchase_request_purchase + purchase_request_delivery'
);

-- B.8 Both trigger functions exist.
select has_function('public', 'purchase_requests_derive_appsheet_status',
  'BEFORE trigger function purchase_requests_derive_appsheet_status exists');
select has_function('public', 'purchase_requests_audit_appsheet',
  'AFTER SECURITY DEFINER trigger function purchase_requests_audit_appsheet exists');

-- B.9 Both triggers are attached to purchase_requests.
select has_trigger('public', 'purchase_requests', 'purchase_requests_derive_appsheet_status',
  'BEFORE UPDATE derive/guard trigger exists on purchase_requests');
select has_trigger('public', 'purchase_requests', 'purchase_requests_audit_appsheet',
  'AFTER UPDATE SECURITY DEFINER audit trigger exists on purchase_requests');

-- B.10 SELECT policy USING clause contains the status-gate values.
--      Regression guard: if the USING expression drifts, this fails.
--      Row-visibility effect (appsheet_writer actually sees approved/purchased/delivered
--      and NOT requested/rejected) is owned by Tier-2 smoke.
select is(
  (select qual like '%approved%' and qual like '%purchased%' and qual like '%delivered%'
     from pg_policies
     where schemaname = 'public' and tablename  = 'purchase_requests'
       and policyname = 'appsheet_writer select by status' and cmd = 'SELECT'),
  true,
  'appsheet_writer SELECT policy USING clause gates on approved/purchased/delivered'
);

-- B.11 UPDATE policy USING clause contains the same status gate.
select is(
  (select qual like '%approved%' and qual like '%purchased%' and qual like '%delivered%'
     from pg_policies
     where schemaname = 'public' and tablename  = 'purchase_requests'
       and policyname = 'appsheet_writer update by status' and cmd = 'UPDATE'),
  true,
  'appsheet_writer UPDATE policy USING clause gates on approved/purchased/delivered'
);

-- ============================================================================
-- C. Derive/guard trigger: transitions and illegal-move rejections.
--    postgres (BYPASSRLS) drives the UPDATEs; the trigger fires for any role.
-- ============================================================================

-- C.1 approved→purchased: set supplier + order_ref + amount + purchased_at on d3.
--     BEFORE trigger: old.status='approved', new.purchased_at null→non-null
--     → no guard fires → new.status := 'purchased'.
select lives_ok(
  $$ update public.purchase_requests
       set supplier     = 'Test Supplier Ltd',
           order_ref    = 'PO-9999',
           amount       = 12500.00,
           purchased_at = now()
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'approved→purchased: UPDATE on d3 lives (derive trigger advances status)'
);

-- C.2 Status advanced by the derive trigger.
select is(
  (select status::text from public.purchase_requests
     where id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  'purchased',
  'derive trigger advanced d3 status approved→purchased'
);

-- C.3 purchased→delivered: set delivered_at + received_by + delivery_note on d4.
--     BEFORE trigger: old.status='purchased', new.delivered_at null→non-null
--     → no guard fires → new.status := 'delivered'.
select lives_ok(
  $$ update public.purchase_requests
       set delivered_at  = now(),
           received_by   = 'Site Foreman B',
           delivery_note = 'Received in full'
     where id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'purchased→delivered: UPDATE on d4 lives (derive trigger advances status)'
);

-- C.4 Status advanced by the derive trigger.
select is(
  (select status::text from public.purchase_requests
     where id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  'delivered',
  'derive trigger advanced d4 status purchased→delivered'
);

-- C.5 Illegal move: delivered_at set on an approved row → P0001.
--     Guard: new.delivered_at IS NOT NULL AND old.delivered_at IS NULL
--            AND old.status <> 'purchased' (it is 'approved') → raise.
select throws_ok(
  $$ update public.purchase_requests
       set delivered_at = now()
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'P0001',
  null,
  'setting delivered_at on approved row raises P0001 (must go purchased first)'
);

-- C.6 Illegal move (F.3): single UPDATE setting BOTH purchased_at AND delivered_at
--     on an approved row raises P0001.  The delivered_at guard fires first
--     (old.status = ''approved'' <> ''purchased''), blocking the skip-to-delivered attempt.
select throws_ok(
  $$ update public.purchase_requests
       set purchased_at = now(),
           delivered_at = now()
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'P0001',
  null,
  'purchased_at + delivered_at on approved row raises P0001 (delivered_at guard fires first)'
);

-- ============================================================================
-- D. Audit: AFTER SECURITY DEFINER trigger writes correct rows.
--
--    principal assertion (D.4, D.8, D.13): in this pgTAP environment,
--    session_user = current_user = postgres (the test runner).  The assertion
--    verifies that the trigger captures session_user — not current_user — by
--    comparing the stored value to session_user at assertion time.  In this
--    environment both are ''postgres'' so the check passes, but it does NOT
--    prove session_user ≠ current_user.  That distinction (payload = ''appsheet_writer''
--    under a real login) is owned by Tier-2 smoke (see ADR 0025 § Testing note).
-- ============================================================================

-- D.1 approved→purchased (d3) → exactly one purchase_request_purchase audit row.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_purchase'
       and target_table = 'purchase_requests'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'exactly one purchase_request_purchase audit row for approved→purchased (d3)'
);

-- Payload-shape pin (ADR 0026 Decision C — one canonical shape): the
-- purchase payload's keys are EXACTLY the original five; eta is audited
-- only as a case-3 correction diff, never in the transition payload.
select is(
  (select array_agg(k order by k)
     from jsonb_object_keys(
       (select payload from public.audit_log
          where action = 'purchase_request_purchase'
            and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid
          limit 1)) as k),
  array['amount', 'order_ref', 'principal', 'purchased_at', 'supplier'],
  'purchase payload keys are exactly {amount,order_ref,principal,purchased_at,supplier} — no eta'
);

-- D.2 actor_id IS NULL (no auth.uid() in a direct-DB session).
select is(
  (select actor_id from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::uuid,
  'actor_id IS NULL for purchase audit row (no auth.uid() in direct-DB session)'
);

-- D.3 actor_role IS NULL (current_user_role() returns NULL with no JWT).
select is(
  (select actor_role from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::public.user_role,
  'actor_role IS NULL for purchase audit row (no JWT; current_user_role() returns NULL)'
);

-- D.4 Principal = session_user (captured by the SECURITY DEFINER trigger).
select is(
  (select payload->>'principal' from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  (select session_user::text),
  'principal = session_user for purchase audit row (trigger correctly captures session_user)'
);

-- D.5 purchased→delivered (d4) → exactly one purchase_request_delivery audit row.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_delivery'
       and target_table = 'purchase_requests'
       and target_id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'exactly one purchase_request_delivery audit row for purchased→delivered (d4)'
);

-- D.6 actor_id IS NULL (delivery).
select is(
  (select actor_id from public.audit_log
     where action = 'purchase_request_delivery'
       and target_id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::uuid,
  'actor_id IS NULL for delivery audit row'
);

-- D.7 actor_role IS NULL (delivery).
select is(
  (select actor_role from public.audit_log
     where action = 'purchase_request_delivery'
       and target_id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::public.user_role,
  'actor_role IS NULL for delivery audit row'
);

-- D.8 Principal = session_user (delivery).
select is(
  (select payload->>'principal' from public.audit_log
     where action = 'purchase_request_delivery'
       and target_id = 'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  (select session_user::text),
  'principal = session_user for delivery audit row'
);

-- D.9 Field correction: UPDATE amount on d6 (approved, 8000 → 9000) lives.
--     d6 is still ''approved'' — C.5 and C.6 both raised P0001 and were rolled back.
--     No status transition; AFTER trigger fires on old.amount IS DISTINCT FROM new.amount.
select lives_ok(
  $$ update public.purchase_requests
       set amount = 9000.00
     where id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'field-correction UPDATE on d6 (amount 8000 → 9000) lives'
);

-- D.10 Exactly one action=''update'' audit row written for d6.
select is(
  (select count(*)::int from public.audit_log
     where action = 'update'
       and target_table = 'purchase_requests'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'exactly one action=update audit row for amount field-correction on d6'
);

-- D.11 actor_id IS NULL (field correction).
select is(
  (select actor_id from public.audit_log
     where action = 'update'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::uuid,
  'actor_id IS NULL for field-correction audit row'
);

-- D.12 actor_role IS NULL (field correction).
select is(
  (select actor_role from public.audit_log
     where action = 'update'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  null::public.user_role,
  'actor_role IS NULL for field-correction audit row'
);

-- D.13 Principal = session_user (field correction).
select is(
  (select payload->>'principal' from public.audit_log
     where action = 'update'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  (select session_user::text),
  'principal = session_user for field-correction audit row'
);

-- D.14 Field-correction payload contains a non-null ''changed'' diff object.
select is(
  (select (payload->'changed') is not null from public.audit_log
     where action = 'update'
       and target_id = 'd6000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  true,
  'field-correction audit payload contains ''changed'' diff object'
);

-- D.15 P1b decision trigger (WHEN old.status=''requested'') did NOT fire on d3/d4 —
--      disjoint WHEN clauses make double-audit impossible by construction.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_decision'
       and target_id in (
         'd3000001-dddd-dddd-dddd-dddddddddddd'::uuid,
         'd4000001-dddd-dddd-dddd-dddddddddddd'::uuid
       )),
  0,
  'P1b decision trigger did NOT fire on AppSheet transitions (disjoint WHEN clauses)'
);

-- D.16 No-op UPDATE (H.7): setting supplier to its existing value on d5 lives.
select lives_ok(
  $$ update public.purchase_requests
       set supplier = 'XYZ Supplies'
     where id = 'd5000001-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  'no-op UPDATE (supplier unchanged on d5 delivered) lives'
);

-- D.17 No-op UPDATE writes ZERO audit rows.
--      AFTER trigger WHEN: old.status IN (...''delivered''...) = true, but
--      old.supplier IS DISTINCT FROM new.supplier = false (same value), and all
--      other fact columns unchanged → WHEN = false → trigger body never executes.
select is(
  (select count(*)::int from public.audit_log
     where target_table = 'purchase_requests'
       and target_id = 'd5000001-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'no-op UPDATE on d5 (delivered) writes ZERO audit rows — tightened WHEN clause'
);

select * from finish();
rollback;
