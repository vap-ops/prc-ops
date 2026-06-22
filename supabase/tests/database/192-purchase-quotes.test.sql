begin;
select plan(13);

-- ============================================================================
-- Spec 182 U1 — purchase_quotes: supplier quotes on an APPROVED PR for price
-- comparison. Back-office write (PM/procurement/super) + back-office READ ONLY
-- (site_admin sees nothing — unit_price is money). One quote per supplier per PR.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-111111111192', 'proc@q192.local', '{}'::jsonb),
  ('d3333333-3333-3333-3333-333333333192', 'sa@q192.local',   '{}'::jsonb),
  ('d9999999-9999-9999-9999-999999999192', 'super@q192.local','{}'::jsonb);
update public.users set role='procurement' where id='d1111111-1111-1111-1111-111111111192';
update public.users set role='site_admin'  where id='d3333333-3333-3333-3333-333333333192';
update public.users set role='super_admin' where id='d9999999-9999-9999-9999-999999999192';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000192', 'Q192', 'price compare 192');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000192', 'aa000000-0000-0000-0000-000000000192', 'WP192', 'งาน 192');
insert into public.suppliers (id, name, created_by) values
  ('51000000-0000-0000-0000-000000000192', 'ส.รุ่งเรือง', 'd9999999-9999-9999-9999-999999999192'),
  ('52000000-0000-0000-0000-000000000192', 'ไทยวัสดุ',   'd9999999-9999-9999-9999-999999999192');
-- An APPROVED PR (quotable) and a REQUESTED PR (not yet quotable).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, status, requested_by, approved_by, source) values
  ('a1000000-0000-0000-0000-000000000192', 'cc000000-0000-0000-0000-000000000192',
   'เหล็กข้ออ้อย 12 มิล', 50, 'ท่อน', 'approved',
   'd9999999-9999-9999-9999-999999999192', 'd9999999-9999-9999-9999-999999999192', 'app'),
  ('a2000000-0000-0000-0000-000000000192', 'cc000000-0000-0000-0000-000000000192',
   'ปูนถุง', 100, 'ถุง', 'requested', 'd9999999-9999-9999-9999-999999999192', null, 'app');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select is(has_function_privilege('anon',
  'public.add_purchase_quote(uuid, uuid, numeric, text)', 'EXECUTE'),
  false, 'anon cannot execute add_purchase_quote');
select is(has_function_privilege('anon',
  'public.remove_purchase_quote(uuid)', 'EXECUTE'),
  false, 'anon cannot execute remove_purchase_quote');

set local role authenticated;

-- A. procurement records two supplier quotes on the approved PR.
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-111111111192"}';
select isnt(
  (select public.add_purchase_quote('a1000000-0000-0000-0000-000000000192',
     '51000000-0000-0000-0000-000000000192', 92, 'ส่งฟรี')),
  null, 'procurement adds a quote (supplier 1)');
select isnt(
  (select public.add_purchase_quote('a1000000-0000-0000-0000-000000000192',
     '52000000-0000-0000-0000-000000000192', 98, null)),
  null, 'procurement adds a quote (supplier 2)');
select is(
  (select count(*)::int from public.purchase_quotes
     where purchase_request_id='a1000000-0000-0000-0000-000000000192'),
  2, 'back-office reads both quotes');

-- B. One quote per supplier per PR.
select throws_ok(
  $$ select public.add_purchase_quote('a1000000-0000-0000-0000-000000000192',
       '51000000-0000-0000-0000-000000000192', 90, null) $$,
  '23505', null, 'duplicate supplier on the same PR → 23505');

-- C. Quoting needs an APPROVED PR.
select throws_ok(
  $$ select public.add_purchase_quote('a2000000-0000-0000-0000-000000000192',
       '51000000-0000-0000-0000-000000000192', 50, null) $$,
  '22023', null, 'a non-approved (requested) PR cannot be quoted → 22023');

-- D. site_admin: cannot write, cannot read (unit_price is money).
set local "request.jwt.claims" = '{"sub": "d3333333-3333-3333-3333-333333333192"}';
select throws_ok(
  $$ select public.add_purchase_quote('a1000000-0000-0000-0000-000000000192',
       '51000000-0000-0000-0000-000000000192', 80, null) $$,
  '42501', null, 'site_admin cannot add a quote (back-office only)');
select is(
  (select count(*)::int from public.purchase_quotes
     where purchase_request_id='a1000000-0000-0000-0000-000000000192'),
  0, 'site_admin cannot READ quotes (RLS hides unit_price)');

-- E. remove a quote (procurement).
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-111111111192"}';
select lives_ok(
  $$ select public.remove_purchase_quote(
       (select id from public.purchase_quotes
          where purchase_request_id='a1000000-0000-0000-0000-000000000192'
            and supplier_id='52000000-0000-0000-0000-000000000192')) $$,
  'procurement removes a quote');
select is(
  (select count(*)::int from public.purchase_quotes
     where purchase_request_id='a1000000-0000-0000-0000-000000000192'),
  1, 'one quote remains after removal');
select throws_ok(
  $$ select public.remove_purchase_quote('00000000-0000-0000-0000-0000000000ff') $$,
  '22023', null, 'removing an unknown quote → 22023');

-- F. visitor cannot read either.
set local "request.jwt.claims" = '{"sub": "d3333333-3333-3333-3333-333333333192"}';
select is(
  has_table_privilege('anon', 'public.purchase_quotes', 'SELECT'),
  false, 'anon has no SELECT grant on purchase_quotes');

reset role;

select * from finish();
rollback;
