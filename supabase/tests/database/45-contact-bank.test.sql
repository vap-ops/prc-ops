begin;
select plan(15);

-- ============================================================================
-- Spec 85 — contact_bank: MONEY isolation. Zero authenticated access (RLS on,
-- no policies/grants); write only via set_contact_bank (PM/super); read only via
-- service-role admin. Typed FKs with exactly-one-target.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-2222222245ff', 'sa@cb-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333345ff', 'pm@cb-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444445ff', 'visitor@cb-test.local', '{}'::jsonb),
  -- Spec 172 Phase B: procurement now manages contractor bank.
  ('66666666-6666-6666-6666-6666666645ff', 'proc@cb-test.local',    '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222245ff';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333345ff';
update public.users set role = 'procurement'      where id = '66666666-6666-6666-6666-6666666645ff';
-- 4444…45ff keeps default 'visitor'.

insert into public.contractors (id, name, created_by) values
  ('c0000000-45ff-45ff-45ff-45ff45ff45ff', 'แบงก์เทสต์',
   '33333333-3333-3333-3333-3333333345ff'),
  -- Spec 172 Phase B: a 2nd contractor for procurement's bank test (keeps the
  -- section-D outcome on the first contractor intact).
  ('c1000000-45ff-45ff-45ff-45ff45ff45ff', 'แบงก์เทสต์ จัดซื้อ',
   '33333333-3333-3333-3333-3333333345ff');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- B. Catalog + isolation (owner context).
select has_table('public', 'contact_bank', 'contact_bank exists');
select is((select relrowsecurity from pg_class where oid = 'public.contact_bank'::regclass),
  true, 'RLS enabled on contact_bank');
select is(has_table_privilege('authenticated', 'public.contact_bank', 'SELECT'),
  false, 'authenticated has NO SELECT on contact_bank (money isolation)');
select is(has_table_privilege('authenticated', 'public.contact_bank', 'INSERT'),
  false, 'authenticated has NO INSERT on contact_bank (money isolation)');
select has_function('public', 'set_contact_bank', 'set_contact_bank RPC exists');
-- exactly-one-target CHECK.
select throws_ok(
  $$ insert into public.contact_bank (updated_by)
     values ('33333333-3333-3333-3333-3333333345ff') $$,
  '23514', null, 'exactly-one-target CHECK rejects zero targets');
select throws_ok(
  $$ insert into public.contact_bank (contractor_id, supplier_id, updated_by)
     values ('c0000000-45ff-45ff-45ff-45ff45ff45ff',
             'c0000000-45ff-45ff-45ff-45ff45ff45ff',
             '33333333-3333-3333-3333-3333333345ff') $$,
  '23514', null, 'exactly-one-target CHECK rejects two targets');

-- C. Role-sim.
set local role authenticated;

-- SA cannot call the RPC (bank is money — pm/super only).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222245ff"}';
select throws_ok(
  $$ select public.set_contact_bank(
       'c0000000-45ff-45ff-45ff-45ff45ff45ff', null, null, 'ธ.กรุงเทพ', '123', 'แบงก์เทสต์') $$,
  '42501', null, 'site_admin cannot call set_contact_bank');

-- Visitor cannot call it.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444445ff"}';
select throws_ok(
  $$ select public.set_contact_bank(
       'c0000000-45ff-45ff-45ff-45ff45ff45ff', null, null, 'x', 'y', 'z') $$,
  '42501', null, 'visitor cannot call set_contact_bank');

-- PM upserts: first insert, then update the same target.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333345ff"}';
select lives_ok(
  $$ select public.set_contact_bank(
       'c0000000-45ff-45ff-45ff-45ff45ff45ff', null, null, 'ธ.กรุงเทพ', '111', 'แบงก์เทสต์') $$,
  'PM sets bank info (insert)');
select lives_ok(
  $$ select public.set_contact_bank(
       'c0000000-45ff-45ff-45ff-45ff45ff45ff', null, null, 'ธ.กสิกร', '222', 'แบงก์เทสต์') $$,
  'PM updates the same target (upsert)');

-- Spec 172 Phase B: procurement may set a contractor's bank (own 2nd contractor,
-- leaves the section-D outcome on the first contractor intact).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-6666666645ff"}';
select lives_ok(
  $$ select public.set_contact_bank(
       'c1000000-45ff-45ff-45ff-45ff45ff45ff', null, null, 'ธ.ไทยพาณิชย์', '999', 'แบงก์เทสต์ จัดซื้อ') $$,
  'spec 172: procurement sets a contractor''s bank');

reset role;

-- D. Outcome (owner context reads — money is owner/admin only).
select is(
  (select count(*)::int from public.contact_bank
     where contractor_id = 'c0000000-45ff-45ff-45ff-45ff45ff45ff'),
  1, 'upsert kept exactly one bank row for the contractor');
select is(
  (select bank_name from public.contact_bank
     where contractor_id = 'c0000000-45ff-45ff-45ff-45ff45ff45ff'),
  'ธ.กสิกร', 'the second call updated the bank row in place');
-- partial-unique guard: a second raw row for the same contractor is rejected.
select throws_ok(
  $$ insert into public.contact_bank (contractor_id, updated_by)
     values ('c0000000-45ff-45ff-45ff-45ff45ff45ff',
             '33333333-3333-3333-3333-3333333345ff') $$,
  '23505', null, 'partial-unique: one bank row per contractor');

select * from finish();
rollback;
