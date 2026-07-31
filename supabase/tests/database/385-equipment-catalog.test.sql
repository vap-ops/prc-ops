-- Spec 385 U1 — ทะเบียนเครื่องมือ/เครื่องจักร as a SKU catalog (equipment_catalog_items).
--
-- Operator 2026-07-31: "เครื่องตบดิน is supposed to be only 1 in ทะเบียน, as in SKU.
-- then user can pick from ทะเบียน when they want to add new equipments." Keyword
-- `catalog` chosen by the operator for consistency with catalog_items (materials)
-- and the planned rental_catalog_items (spec 361).
--
-- What this file pins:
--   A. the table exists, RLS is on, duplicate ACTIVE names are impossible at the
--      index level (the spec-344 disease, prevented at birth), and the instance
--      table gained its nullable SKU FK.
--   B. the money wall is COLUMN ABSENCE, mirroring equipment_items (ADR 0055
--      decision 6): `default_daily_rate` carries NO authenticated grant in either
--      direction, with a positive control so the assert cannot pass vacuously.
--   C. behaviour through real role switches: back-office writes, site_admin reads
--      but cannot write, and the active-name unique index actually bites on a
--      whitespace/case variant (expression index, not a plain column index).
--
-- NO assertions on the seeded SKU rows themselves: seed content is operator-owned
-- master data (the 119-item-catalog lesson — never pin exact values of data a
-- human may legitimately edit). The invariants above are what must survive.

begin;
select plan(16);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e201','cat-pm@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-00000000e202','cat-sa@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-00000000e205','cat-tech@t.local','{}'::jsonb);
update public.users set role='procurement_manager' where id='00000000-0000-0000-0000-00000000e201';
update public.users set role='site_admin'          where id='00000000-0000-0000-0000-00000000e202';
update public.users set role='technician'          where id='00000000-0000-0000-0000-00000000e205';

-- fixture category (RLS bypassed for setup; no dependence on live seed data)
insert into public.equipment_categories (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000e203','ทดสอบหมวดแคตตาล็อก','00000000-0000-0000-0000-00000000e201');

-- ============================================================================
-- A. Shape: table, RLS, the active-name unique index, the instance FK.
-- ============================================================================
select has_table('public', 'equipment_catalog_items', 'equipment_catalog_items exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.equipment_catalog_items'::regclass),
  true,
  'RLS is enabled on equipment_catalog_items'
);

select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public'
      and tablename  = 'equipment_catalog_items'
      and indexname  = 'equipment_catalog_items_active_name_key'),
  1,
  'the partial unique index on lower(trim(name)) where is_active exists'
);

select has_column('public', 'equipment_items', 'equipment_catalog_item_id',
  'equipment_items gained its nullable SKU FK column');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.equipment_items'::regclass
      and contype = 'f'
      and confrelid = 'public.equipment_catalog_items'::regclass),
  1,
  'equipment_items.equipment_catalog_item_id references equipment_catalog_items'
);

-- ============================================================================
-- B. Money wall = column ABSENCE (mirrors equipment_items.daily_rate).
-- ============================================================================
select is(
  has_column_privilege('authenticated', 'public.equipment_catalog_items', 'default_daily_rate', 'SELECT'),
  false,
  'authenticated may NOT read default_daily_rate (money wall, ADR 0055 d6)'
);

-- positive control: the wall assert above cannot be green because grants are
-- missing wholesale.
select is(
  has_column_privilege('authenticated', 'public.equipment_catalog_items', 'name', 'SELECT'),
  true,
  'authenticated DOES hold SELECT on name (positive control for the wall)'
);

select is(
  has_column_privilege('authenticated', 'public.equipment_catalog_items', 'default_daily_rate', 'UPDATE'),
  false,
  'authenticated may NOT write default_daily_rate either'
);

select is(
  has_column_privilege('authenticated', 'public.equipment_catalog_items', 'default_daily_rate', 'INSERT'),
  false,
  'authenticated may NOT supply default_daily_rate on insert (wall, third direction)'
);

select is(
  has_column_privilege('anon', 'public.equipment_catalog_items', 'name', 'SELECT'),
  false,
  'anon has no access at all'
);

-- masters posture: SKUs deactivate (is_active), never delete — no grant, no policy.
select is(
  has_table_privilege('authenticated', 'public.equipment_catalog_items', 'DELETE'),
  false,
  'authenticated holds no DELETE on the catalog (deactivate, never delete)'
);

-- ============================================================================
-- C. Behaviour through real role switches.
-- ============================================================================
-- allow role switches to write TAP (the _tap_buf grant trap)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e201"}';

select lives_ok($$
  insert into public.equipment_catalog_items (id, name, category_id, default_tracking, created_by)
  values ('00000000-0000-0000-0000-00000000e204', 'ประแจทดสอบแคตตาล็อก',
          '00000000-0000-0000-0000-00000000e203', 'unit',
          '00000000-0000-0000-0000-00000000e201')
$$, 'procurement_manager (back-office) can create a SKU');

-- the expression index bites: same name back with whitespace + a filled id
select throws_ok($$
  insert into public.equipment_catalog_items (name, category_id, created_by)
  values ('  ประแจทดสอบแคตตาล็อก  ', '00000000-0000-0000-0000-00000000e203',
          '00000000-0000-0000-0000-00000000e201')
$$, '23505', null, 'a duplicate ACTIVE name is refused even as a whitespace variant');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e202"}';

select ok(
  (select count(id) from public.equipment_catalog_items
    where id = '00000000-0000-0000-0000-00000000e204') = 1,
  'site_admin can read the catalog (the pick list is field-visible)'
);

select throws_ok($$
  insert into public.equipment_catalog_items (name, category_id, created_by)
  values ('สว่านทดสอบแคตตาล็อก', '00000000-0000-0000-0000-00000000e203',
          '00000000-0000-0000-0000-00000000e202')
$$, '42501', null, 'site_admin may NOT create SKUs (write stays back-office)');

-- the read audience STOPS at back office + site_admin: a technician sees no rows
-- (the arm this spec widened past equipment_items, pinned in the negative).
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e205"}';

select ok(
  (select count(id) from public.equipment_catalog_items
    where id = '00000000-0000-0000-0000-00000000e204') = 0,
  'technician reads ZERO catalog rows (read audience excludes field-crew roles)'
);

select * from finish();
rollback;
