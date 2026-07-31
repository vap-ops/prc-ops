begin;
select plan(61);

-- ============================================================================
-- Spec 370 U1 — equipment scan in/out schema.
--   Rate-optional borrows (operator call b, 2026-07-28): daily_rate_snapshot
--   nullable, check_out_equipment no longer refuses unpriced items, and an
--   unpriced span charges 0 in wp_equipment_sell (SUM skips null products).
--   Attribution: via (door enum) + borrower_worker_id on the log; the closing
--   row copies the borrower, records its OWN door.
--   equipment_usage_photos: condition evidence, SELECT staff / INSERT movers,
--   no UPDATE/DELETE policy; photos key on the ORIGINAL log id across the
--   check-in supersede.
--   equipment-images storage INSERT policy: back office keeps the depth-1
--   root; movers (incl. site_admin) write usage/<x>/ at depth 2.
--   UUIDs HEX-ONLY.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110370', 'super@scan.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330370', 'pm@scan.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220370', 'sa@scan.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880370', 'vis@scan.local',   '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110370';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330370';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220370';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('ca0a0370-0370-0370-0370-ca0aca0a0370', 'PRC-370-P1', 'โครงการสแกน');

insert into public.work_packages (id, project_id, code, name, status) values
  ('ea0a0370-0370-0370-0370-ea0aea0a0370', 'ca0a0370-0370-0370-0370-ca0aca0a0370',
   'WP-U', 'งานยืมไม่มีราคา', 'in_progress'),
  ('eb0b0370-0370-0370-0370-eb0beb0b0370', 'ca0a0370-0370-0370-0370-ca0aca0a0370',
   'WP-P', 'งานยืมมีราคา', 'in_progress');

-- site_admin must be a member for the F3 membership arm.
insert into public.project_members (project_id, user_id, added_by) values
  ('ca0a0370-0370-0370-0370-ca0aca0a0370', '22222222-2222-2222-2222-222222220370',
   '11111111-1111-1111-1111-111111110370');

insert into public.equipment_owners (id, name, created_by) values
  ('0a0a0370-0370-0370-0370-0a0a0a0a0370', 'PRC เอง',
   '11111111-1111-1111-1111-111111110370');
insert into public.equipment_categories (id, name, created_by) values
  ('cae00370-0370-0370-0370-cae0cae00370', 'เครื่องมือไฟฟ้า',
   '11111111-1111-1111-1111-111111110370');

-- U unpriced (the point of the unit), P priced 800 (positive control),
-- T priced 300 (the site_admin behavioural case).
-- Spec 385 U4: every instance carries its SKU (NOT NULL) - fixture SKU.
insert into public.equipment_catalog_items (id, name, category_id, created_by) values
  ('ca7a0370-0370-0370-0370-ca7aca7a0370', 'fixture-sku-0370', 'cae00370-0370-0370-0370-cae0cae00370', '11111111-1111-1111-1111-111111110370');
insert into public.equipment_items (id, category_id, owner_id, name, daily_rate, created_by, equipment_catalog_item_id) values
  ('17e00370-0370-0370-0370-17e017e00370', 'cae00370-0370-0370-0370-cae0cae00370',
   '0a0a0370-0370-0370-0370-0a0a0a0a0370', 'สว่านไร้ราคา U', null,
   '11111111-1111-1111-1111-111111110370', 'ca7a0370-0370-0370-0370-ca7aca7a0370'),
  ('17e10370-0370-0370-0370-17e117e10370', 'cae00370-0370-0370-0370-cae0cae00370',
   '0a0a0370-0370-0370-0370-0a0a0a0a0370', 'เครื่องตัดมีราคา P', 800,
   '11111111-1111-1111-1111-111111110370', 'ca7a0370-0370-0370-0370-ca7aca7a0370'),
  ('17e20370-0370-0370-0370-17e217e20370', 'cae00370-0370-0370-0370-cae0cae00370',
   '0a0a0370-0370-0370-0370-0a0a0a0a0370', 'ปั๊มมีราคา T', 300,
   '11111111-1111-1111-1111-111111110370', 'ca7a0370-0370-0370-0370-ca7aca7a0370');

insert into public.workers (id, name, created_by) values
  ('a0a00370-0370-0370-0370-a0a0a0a00370', 'ช่างยืมของ',
   '11111111-1111-1111-1111-111111110370');

-- A SECOND project the site_admin is NOT a member of — the photo INSERT
-- policy's F3 membership arm (075863) needs a foreign loan to refuse.
insert into public.projects (id, code, name) values
  ('cb0b0370-0370-0370-0370-cb0bcb0b0370', 'PRC-370-P2', 'โครงการอื่น');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ec0c0370-0370-0370-0370-ec0cec0c0370', 'cb0b0370-0370-0370-0370-cb0bcb0b0370',
   'WP-Z', 'งานต่างโครงการ', 'in_progress');
insert into public.equipment_items (id, category_id, owner_id, name, daily_rate, created_by, equipment_catalog_item_id) values
  ('17e30370-0370-0370-0370-17e317e30370', 'cae00370-0370-0370-0370-cae0cae00370',
   '0a0a0370-0370-0370-0370-0a0a0a0a0370', 'เลื่อยต่างโครงการ Z', null,
   '11111111-1111-1111-1111-111111110370', 'ca7a0370-0370-0370-0370-ca7aca7a0370');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Schema catalog.
-- ============================================================================
select has_table('public', 'equipment_usage_photos', 'equipment_usage_photos exists');
select has_column('public', 'equipment_usage_photos', 'log_id', 'photos.log_id');
select has_column('public', 'equipment_usage_photos', 'phase', 'photos.phase');
select has_column('public', 'equipment_usage_photos', 'storage_path', 'photos.storage_path');
select has_column('public', 'equipment_usage_photos', 'taken_by', 'photos.taken_by');
select col_is_null('public', 'equipment_usage_logs', 'daily_rate_snapshot',
  'daily_rate_snapshot is NULLABLE (rate-optional borrows)');
select has_column('public', 'equipment_usage_logs', 'via', 'logs.via (door attribution)');
select has_column('public', 'equipment_usage_logs', 'borrower_worker_id', 'logs.borrower_worker_id');
select is(
  (select array_agg(enumlabel order by enumsortorder)::text[]
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'equipment_usage_via'),
  array['scan','search','wp_tab','store'], 'equipment_usage_via = scan/search/wp_tab/store');
select is(
  (select array_agg(enumlabel order by enumsortorder)::text[]
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'equipment_photo_phase'),
  array['out','in'], 'equipment_photo_phase = out/in');

-- Old signatures are GONE, new ones exist and are DEFINER + granted right.
select ok(to_regprocedure('public.check_out_equipment(uuid, uuid, date)') is null,
  'old 3-arg check_out_equipment signature is gone');
select ok(to_regprocedure('public.check_in_equipment(uuid, date)') is null,
  'old 2-arg check_in_equipment signature is gone');
select ok(to_regprocedure('public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid)') is not null,
  'new check_out_equipment signature exists');
select ok(to_regprocedure('public.check_in_equipment(uuid, date, public.equipment_usage_via)') is not null,
  'new check_in_equipment signature exists');
select is((select prosecdef from pg_proc
    where oid = 'public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid)'::regprocedure),
  true, 'check_out_equipment is SECURITY DEFINER');
select is((select prosecdef from pg_proc
    where oid = 'public.check_in_equipment(uuid, date, public.equipment_usage_via)'::regprocedure),
  true, 'check_in_equipment is SECURITY DEFINER');
select is(has_function_privilege('anon',
    'public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid)', 'EXECUTE'),
  false, 'anon cannot execute check_out_equipment');
select is(has_function_privilege('anon',
    'public.check_in_equipment(uuid, date, public.equipment_usage_via)', 'EXECUTE'),
  false, 'anon cannot execute check_in_equipment');
select is(has_function_privilege('authenticated',
    'public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid)', 'EXECUTE'),
  true, 'authenticated can execute check_out_equipment');
select is(has_function_privilege('authenticated',
    'public.check_in_equipment(uuid, date, public.equipment_usage_via)', 'EXECUTE'),
  true, 'authenticated can execute check_in_equipment');

-- Column-grant posture on the logs (075862): the new attribution columns are
-- app-readable, the money wall stands (pin BOTH directions — the 367 lesson:
-- a blanket grant later must RED here, not silently publish the rate).
select is(has_column_privilege('authenticated', 'public.equipment_usage_logs', 'via', 'SELECT'),
  true, 'authenticated CAN read via');
select is(has_column_privilege('authenticated', 'public.equipment_usage_logs', 'borrower_worker_id', 'SELECT'),
  true, 'authenticated CAN read borrower_worker_id');
select is(has_column_privilege('authenticated', 'public.equipment_usage_logs', 'daily_rate_snapshot', 'SELECT'),
  false, 'daily_rate_snapshot stays money-walled from authenticated');

-- Photos are append-only in practice: no UPDATE or DELETE policy exists —
-- with the SELECT/INSERT counts as the positive control proving polcmd codes
-- are the ones we think they are (the absence-assert rule).
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.equipment_usage_photos'::regclass and polcmd = 'w'),
  0, 'equipment_usage_photos has NO update policy');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.equipment_usage_photos'::regclass and polcmd = 'd'),
  0, 'equipment_usage_photos has NO delete policy');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.equipment_usage_photos'::regclass and polcmd = 'r'),
  1, 'positive control: exactly one SELECT policy');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.equipment_usage_photos'::regclass and polcmd = 'a'),
  1, 'positive control: exactly one INSERT policy');

-- The GRANT layer matches (the fresh-eyes 🔴: default privileges left ALL —
-- including RLS-bypassing TRUNCATE — on the new table until 075863 revoked).
select is(has_table_privilege('authenticated', 'public.equipment_usage_photos', 'UPDATE'),
  false, 'authenticated holds NO UPDATE grant on photos');
select is(has_table_privilege('authenticated', 'public.equipment_usage_photos', 'DELETE'),
  false, 'authenticated holds NO DELETE grant on photos');
select is(has_table_privilege('authenticated', 'public.equipment_usage_photos', 'TRUNCATE'),
  false, 'authenticated holds NO TRUNCATE grant on photos (RLS cannot gate it)');
select is(has_table_privilege('anon', 'public.equipment_usage_photos', 'SELECT'),
  false, 'anon holds NO grant at all on photos');

set local role authenticated;

-- ============================================================================
-- B. Rate-optional checkout + attribution.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880370"}';
select throws_ok(
  $$ select public.check_out_equipment('17e00370-0370-0370-0370-17e017e00370',
       'ea0a0370-0370-0370-0370-ea0aea0a0370', date '2026-07-01') $$,
  '42501', null, 'visitor still cannot check out');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110370"}';
select lives_ok(
  $$ select public.check_out_equipment('17e00370-0370-0370-0370-17e017e00370',
       'ea0a0370-0370-0370-0370-ea0aea0a0370', date '2026-07-01',
       'scan', 'a0a00370-0370-0370-0370-a0a0a0a00370') $$,
  'an UNPRICED item checks out (the rate refusal is gone)');

-- Row-content asserts run PRIVILEGED: daily_rate_snapshot is column-walled from
-- authenticated (105's ADR 0055 posture), so reading it under the app role
-- would 42501 the test itself.
reset role;
select is(
  (select daily_rate_snapshot is null from public.equipment_usage_logs
    where item_id='17e00370-0370-0370-0370-17e017e00370' and superseded_by is null),
  true, 'unpriced span snapshots NULL');
select is(
  (select via::text from public.equipment_usage_logs
    where item_id='17e00370-0370-0370-0370-17e017e00370' and superseded_by is null),
  'scan', 'borrow door recorded (via = scan)');
select is(
  (select borrower_worker_id from public.equipment_usage_logs
    where item_id='17e00370-0370-0370-0370-17e017e00370' and superseded_by is null),
  'a0a00370-0370-0370-0370-a0a0a0a00370'::uuid, 'borrower recorded');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110370"}';
-- The unpriced open span charges NOTHING (SUM skips the null product).
select is(
  (select public.wp_equipment_sell('ea0a0370-0370-0370-0370-ea0aea0a0370')),
  0::numeric, 'wp_equipment_sell = 0 over an unpriced open span');

-- 3-arg call form still works (defaults land as null via/borrower).
select lives_ok(
  $$ select public.check_out_equipment('17e10370-0370-0370-0370-17e117e10370',
       'eb0b0370-0370-0370-0370-eb0beb0b0370', date '2026-07-01') $$,
  'priced item checks out via the legacy 3-arg call form');

reset role;
select is(
  (select daily_rate_snapshot from public.equipment_usage_logs
    where item_id='17e10370-0370-0370-0370-17e117e10370' and superseded_by is null),
  800::numeric, 'priced span still snapshots the rate (positive control)');
select is(
  (select via is null from public.equipment_usage_logs
    where item_id='17e10370-0370-0370-0370-17e117e10370' and superseded_by is null),
  true, 'legacy call form leaves via null');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110370"}';

select throws_ok(
  $$ select public.check_out_equipment('17e20370-0370-0370-0370-17e217e20370',
       'ea0a0370-0370-0370-0370-ea0aea0a0370', date '2026-07-01',
       'scan', 'deadbeef-0370-0370-0370-deadbeef0370') $$,
  'P0001', null, 'unknown borrower refused by name (not a bare FK error)');
select throws_ok(
  $$ select public.check_out_equipment('17e00370-0370-0370-0370-17e017e00370',
       'eb0b0370-0370-0370-0370-eb0beb0b0370', date '2026-07-02') $$,
  'P0001', null, 'one-open-span guard survives the rewrite');

-- site_admin (member) still passes the membership arm. T goes to WP-P so its
-- PRICED open span never pollutes WP-U's charge-0 assertions.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220370"}';
select lives_ok(
  $$ select public.check_out_equipment('17e20370-0370-0370-0370-17e217e20370',
       'eb0b0370-0370-0370-0370-eb0beb0b0370', date '2026-07-03', 'wp_tab') $$,
  'site_admin member still checks out (membership arm intact)');

-- ============================================================================
-- C. Check-in: closing row copies borrower + null rate, records its own door.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110370"}';
select lives_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
         where item_id='17e00370-0370-0370-0370-17e017e00370'
           and checked_in_on is null and superseded_by is null),
       date '2026-07-05', 'store') $$,
  'null-rate span closes (check_in accepts it)');
select is(
  (select public.wp_equipment_sell('ea0a0370-0370-0370-0370-ea0aea0a0370')),
  0::numeric, 'closed unpriced span still charges 0 on WP-U');

reset role;
select is(
  (select count(*)::int from public.equipment_usage_logs
    where item_id='17e00370-0370-0370-0370-17e017e00370'
      and checked_in_on = date '2026-07-05'
      and daily_rate_snapshot is null
      and via::text = 'store'
      and borrower_worker_id = 'a0a00370-0370-0370-0370-a0a0a0a00370'
      and superseded_by is not null),
  1, 'closing row: null rate kept, return door = store, borrower copied, supersedes the original');
set local role authenticated;

-- ============================================================================
-- D. equipment_usage_photos RLS. Photos key on the ORIGINAL log id — U's span
--    is already CLOSED above (a successor points superseded_by at it, while the
--    original's own columns stay null), so this insert pins the chain shape:
--    condition photos survive the supersede on the original id.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220370"}';
select lives_ok(
  $$ insert into public.equipment_usage_photos (log_id, phase, storage_path, taken_by)
     values ((select id from public.equipment_usage_logs
               where item_id='17e00370-0370-0370-0370-17e017e00370'
                 and superseded_by is null and checked_in_on is null
                 limit 1),
             'out', 'usage/x/a.jpg', '22222222-2222-2222-2222-222222220370') $$,
  'site_admin attaches a condition photo to the ORIGINAL (superseded) log row');
select throws_ok(
  $$ insert into public.equipment_usage_photos (log_id, phase, storage_path, taken_by)
     values ((select id from public.equipment_usage_logs limit 1),
             'out', 'usage/x/b.jpg', '33333333-3333-3333-3333-333333330370') $$,
  '42501', null, 'taken_by must be the caller (mis-attribution refused)');
select is(
  (select count(*)::int from public.equipment_usage_photos
    where storage_path = 'usage/x/a.jpg'),
  1, 'site_admin reads the photo back (staff SELECT policy)');

-- The supersede trap, both directions (the spec's "trap of the unit"): the
-- photo sits on the ORIGINAL (superseded) row; the closing row carries none.
reset role;
select is(
  (select count(*)::int from public.equipment_usage_photos p
     join public.equipment_usage_logs l on l.id = p.log_id
    where l.item_id='17e00370-0370-0370-0370-17e017e00370'
      and l.superseded_by is null),
  1, 'the condition photo hangs off the ORIGINAL row');
select is(
  (select count(*)::int from public.equipment_usage_photos p
     join public.equipment_usage_logs l on l.id = p.log_id
    where l.item_id='17e00370-0370-0370-0370-17e017e00370'
      and l.superseded_by is not null),
  0, 'the CLOSING row carries zero photos — readers must follow the chain');

-- F3 membership arm on the photo policy: open a foreign-project loan, then the
-- non-member site_admin is refused on ITS log.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110370"}';
select lives_ok(
  $$ select public.check_out_equipment('17e30370-0370-0370-0370-17e317e30370',
       'ec0c0370-0370-0370-0370-ec0cec0c0370', date '2026-07-04') $$,
  'super opens a loan on the OTHER project');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220370"}';
select throws_ok(
  $$ insert into public.equipment_usage_photos (log_id, phase, storage_path, taken_by)
     values ((select l.id from public.equipment_usage_logs l
               where l.item_id='17e30370-0370-0370-0370-17e317e30370'
                 and l.superseded_by is null),
             'out', 'usage/z/evil.jpg', '22222222-2222-2222-2222-222222220370') $$,
  '42501', null, 'non-member site_admin cannot attach evidence to a foreign loan (F3 arm)');

set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880370"}';
select throws_ok(
  $$ insert into public.equipment_usage_photos (log_id, phase, storage_path, taken_by)
     values ((select id from public.equipment_usage_logs limit 1),
             'out', 'usage/x/c.jpg', '88888888-8888-8888-8888-888888880370') $$,
  '42501', null, 'visitor cannot insert a condition photo');
select is(
  (select count(*)::int from public.equipment_usage_photos),
  0, 'visitor reads NOTHING from equipment_usage_photos (staff-only SELECT)');

-- ============================================================================
-- E. Storage: back office keeps the depth-1 root; movers write usage/ depth-2.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220370"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('equipment-images', 'usage/17e00370/a.jpg') $$,
  'site_admin uploads under usage/<x>/ (depth 2)');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('equipment-images', '17e00370/reg.jpg') $$,
  '42501', null, 'site_admin cannot write the registry root (depth 1)');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('equipment-images', 'usage/17e00370/deep/b.jpg') $$,
  '42501', null, 'depth-3 path refused even for movers');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330370"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('equipment-images', '17e00370/reg.jpg') $$,
  'back office still uploads registry images at the root');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('equipment-images', 'usage/17e00370/pm.jpg') $$,
  'back office may also upload usage photos');

set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880370"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('equipment-images', 'usage/17e00370/vis.jpg') $$,
  '42501', null, 'visitor cannot upload anywhere in equipment-images');

reset role;

select * from finish();
rollback;
