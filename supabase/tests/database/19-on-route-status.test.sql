begin;
select plan(16);

-- ============================================================================
-- Spec 22 / ADR 0027 — on_route lifecycle stage.
-- Tier 1 (this file, as postgres): enum/column/grant/policy catalog + derive
-- and audit trigger behavior. Tier 2 (smoke under appsheet_writer login):
-- row-visibility of on_route rows, principal capture — per ADR 0025.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000002-0000-0000-0000-000000000002', 'pm@or-test.local', '{}'::jsonb),
  ('a0000002-0000-0000-0000-000000000003', 'sa@or-test.local', '{}'::jsonb);

insert into public.projects (id, code, name) values
  ('b0000002-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PRC-TEST-OR', 'on_route test project');

insert into public.work_packages (id, project_id, code, name) values
  ('c0000002-cccc-cccc-cccc-cccccccccccc',
   'b0000002-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'WP-OR-01', 'on_route test WP');

-- e1: purchased — the purchased→on_route fixture, then on_route→delivered.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at,
   supplier, order_ref, amount, purchased_at)
values
  ('e1000002-eeee-eeee-eeee-eeeeeeeeeeee',
   'c0000002-cccc-cccc-cccc-cccccccccccc',
   'Cement bags', 40, 'bag',
   'a0000002-0000-0000-0000-000000000003',
   'purchased',
   'a0000002-0000-0000-0000-000000000002',
   now() - interval '2 days',
   'OR Supplier', 'PO-OR-001', 9999.00, now() - interval '1 day');

-- e2: purchased — the skip fixture: purchased→delivered with shipped_at NULL
--     must stay legal (ADR 0027: on_route is skippable).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at,
   supplier, order_ref, amount, purchased_at)
values
  ('e2000002-eeee-eeee-eeee-eeeeeeeeeeee',
   'c0000002-cccc-cccc-cccc-cccccccccccc',
   'Gravel', 3, 'truck',
   'a0000002-0000-0000-0000-000000000003',
   'purchased',
   'a0000002-0000-0000-0000-000000000002',
   now() - interval '2 days',
   'OR Supplier', 'PO-OR-002', 4000.00, now() - interval '1 day');

-- e3: approved — illegal-move fixture: shipped_at before purchase.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at)
values
  ('e3000002-eeee-eeee-eeee-eeeeeeeeeeee',
   'c0000002-cccc-cccc-cccc-cccccccccccc',
   'Sand', 2, 'truck',
   'a0000002-0000-0000-0000-000000000003',
   'approved',
   'a0000002-0000-0000-0000-000000000002',
   now());

-- ============================================================================
-- B. Catalog.
-- ============================================================================

-- B.1 Enum gained on_route, ordered after purchased.
select enum_has_labels(
  'public', 'purchase_request_status',
  array['requested', 'approved', 'rejected', 'purchased', 'on_route', 'delivered'],
  'purchase_request_status enum includes on_route after purchased'
);

-- B.2 shipped_at column exists and is nullable timestamptz.
select has_column('public', 'purchase_requests', 'shipped_at',
  'purchase_requests.shipped_at exists');
select col_type_is('public', 'purchase_requests', 'shipped_at',
  'timestamp with time zone', 'shipped_at is timestamptz');

-- B.3 Grant: shipped_at is the 9th appsheet_writer-writable column; status
--     stays un-granted (the ADR 0025 privilege-layer guarantee).
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'shipped_at', 'UPDATE'),
  true,  'appsheet_writer has UPDATE on shipped_at (ADR 0027)');
select is(has_column_privilege('appsheet_writer', 'public.purchase_requests', 'status', 'UPDATE'),
  false, 'appsheet_writer still has NO UPDATE on status');

-- B.4 RLS stage gates name on_route (SELECT + UPDATE policies).
select is(
  (select qual like '%on_route%'
     from pg_policies
     where schemaname = 'public' and tablename = 'purchase_requests'
       and policyname = 'appsheet_writer select by status' and cmd = 'SELECT'),
  true,
  'appsheet_writer SELECT policy USING clause includes on_route'
);
select is(
  (select qual like '%on_route%' and with_check like '%on_route%'
     from pg_policies
     where schemaname = 'public' and tablename = 'purchase_requests'
       and policyname = 'appsheet_writer update by status' and cmd = 'UPDATE'),
  true,
  'appsheet_writer UPDATE policy USING + WITH CHECK include on_route'
);

-- B.5 Silent-audit-gap regression guards: both hard-coded column lists name
--     shipped_at (same doctrine as the eta guards in file 18).
select ok(
  pg_get_functiondef('public.purchase_requests_audit_appsheet()'::regprocedure)
    like '%new.shipped_at%',
  'audit function diff body names shipped_at (9th branch, ADR 0027)'
);
select ok(
  (select pg_get_triggerdef(oid) from pg_trigger
     where tgname = 'purchase_requests_audit_appsheet'
       and tgrelid = 'public.purchase_requests'::regclass)
    like '%shipped_at%',
  'audit trigger WHEN clause names shipped_at (ADR 0027)'
);

-- ============================================================================
-- C. Derive trigger transitions.
-- ============================================================================

-- C.1 purchased→on_route: shipped_at null→non-null on e1.
select lives_ok(
  $$ update public.purchase_requests
       set shipped_at = now()
     where id = 'e1000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid $$,
  'purchased→on_route: setting shipped_at on e1 lives'
);
select is(
  (select status::text from public.purchase_requests
     where id = 'e1000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  'on_route',
  'derive trigger advanced e1 status purchased→on_route'
);

-- C.2 on_route→delivered: delivered_at null→non-null on e1.
select lives_ok(
  $$ update public.purchase_requests
       set delivered_at = now(), received_by = 'Foreman OR'
     where id = 'e1000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid $$,
  'on_route→delivered: setting delivered_at on e1 lives'
);
select is(
  (select status::text from public.purchase_requests
     where id = 'e1000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  'delivered',
  'derive trigger advanced e1 status on_route→delivered'
);

-- C.3 Skip stays legal: purchased→delivered on e2 with shipped_at NULL.
select lives_ok(
  $$ update public.purchase_requests
       set delivered_at = now()
     where id = 'e2000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid $$,
  'purchased→delivered direct (shipped_at NULL) still lives — on_route is skippable'
);

-- C.4 Illegal move: shipped_at on an approved row raises P0001.
select throws_ok(
  $$ update public.purchase_requests
       set shipped_at = now()
     where id = 'e3000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid $$,
  'P0001',
  null,
  'setting shipped_at on approved row raises P0001 (must go purchased first)'
);

-- ============================================================================
-- D. Audit rows.
-- ============================================================================

-- D.1 purchased→on_route audited as action 'update' with transition payload
--     (ADR 0027: no new audit_action enum value).
select is(
  (select count(*)::int from public.audit_log
     where action = 'update'
       and target_table = 'purchase_requests'
       and target_id = 'e1000002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
       and payload->'transition' = '["purchased", "on_route"]'::jsonb),
  1,
  'exactly one update-action audit row with transition payload for purchased→on_route (e1)'
);

select * from finish();
rollback;
