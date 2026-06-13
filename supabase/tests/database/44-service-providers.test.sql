begin;
select plan(13);

-- ============================================================================
-- Spec 84 — service_providers master (ผู้ให้บริการ / รถขนส่ง). Mutable,
-- PM/super-managed, NO delete; eval-once-wrapped policies (file 40 also covers
-- this table globally). status reuses contact_status (spec 83).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-2222222244ee', 'sa@sp-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333344ee', 'pm@sp-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444444ee', 'visitor@sp-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222244ee';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333344ee';
-- 4444…44ee keeps default 'visitor'.

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- B. Catalog (owner context).
select has_table('public', 'service_providers', 'service_providers exists');
select is((select relrowsecurity from pg_class where oid = 'public.service_providers'::regclass),
  true, 'RLS enabled on service_providers');
select policies_are('public', 'service_providers',
  array['service_providers readable by staff',
        'service_providers insert by pm or super_admin',
        'service_providers update by pm or super_admin'],
  'exactly the three service_providers policies — NO delete policy');
select is(has_table_privilege('authenticated', 'public.service_providers', 'DELETE'),
  false, 'authenticated has NO DELETE on service_providers (masters posture)');
select throws_ok(
  $$ insert into public.service_providers (name, created_by)
     values ('   ', '33333333-3333-3333-3333-3333333344ee') $$,
  '23514', null, 'blank name violates service_providers_name_nonblank');
select lives_ok(
  $$ insert into public.service_providers (id, name, created_by)
     values ('5a000000-44ee-44ee-44ee-44ee44ee44ee', 'ขนส่งทดสอบ',
             '33333333-3333-3333-3333-3333333344ee') $$,
  'bare insert with defaults');
select is((select service_subtype::text from public.service_providers
             where id = '5a000000-44ee-44ee-44ee-44ee44ee44ee'),
  'transport', 'service_subtype defaults to transport');
select is((select status::text from public.service_providers
             where id = '5a000000-44ee-44ee-44ee-44ee44ee44ee'),
  'active', 'status defaults to active');

-- C. Role-sim.
set local role authenticated;

-- PM inserts.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333344ee"}';
select lives_ok(
  $$ insert into public.service_providers (id, name, phone, vehicle_type, plate_no, created_by)
     values ('5b000000-44ee-44ee-44ee-44ee44ee44ee', 'บริษัทรถบรรทุก ก', '081-555',
             'รถ 6 ล้อ', '70-1234', '33333333-3333-3333-3333-3333333344ee') $$,
  'PM creates a service provider');

-- SA cannot insert (financial/back-office master = pm/super only).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222244ee"}';
select throws_ok(
  $$ insert into public.service_providers (name, created_by)
     values ('โดย SA', '22222222-2222-2222-2222-2222222244ee') $$,
  '42501', null, 'site_admin cannot insert a service provider');
-- ...but SA (staff) CAN read.
select cmp_ok(
  (select count(*)::int from public.service_providers), '>=', 1,
  'site_admin can SELECT service_providers (staff read)');

-- Visitor sees none.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444444ee"}';
select is(
  (select count(*)::int from public.service_providers), 0,
  'visitor sees no service_providers (SELECT policy excludes)');

reset role;

-- D. Outcome.
select is(
  (select created_by from public.service_providers
     where id = '5b000000-44ee-44ee-44ee-44ee44ee44ee'),
  '33333333-3333-3333-3333-3333333344ee'::uuid,
  'created_by pinned to the creating PM');

select * from finish();
rollback;
