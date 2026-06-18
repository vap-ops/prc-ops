begin;
select plan(15);

-- ============================================================================
-- Spec 141 U3 / ADR 0055 §4 — equipment_movements (append-only custody log).
-- Pins: catalog + enum, the kind<->project CHECK, quantity>=1, append-only (no
-- update/delete grant), staff INSERT with a created_by pin, the status-derive
-- trigger (deployed -> on_site, returned -> returned), anon denial.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110143', 'pm@equipmv.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220143', 'sa@equipmv.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330143', 'vi@equipmv.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110143';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220143';
-- third user stays visitor

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000143', 'TAP-EQUIPMV', 'Equipment movements fixture');
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000143', 'Sister Co', '11111111-1111-1111-1111-111111110143');
insert into public.equipment_categories (id, name, created_by) values
  ('c0000001-0000-4000-8000-000000000143', 'Generators', '11111111-1111-1111-1111-111111110143');
insert into public.equipment_items (id, category_id, owner_id, name, tracking, created_by) values
  ('d0000001-0000-4000-8000-000000000143',
   'c0000001-0000-4000-8000-000000000143', 'b0000001-0000-4000-8000-000000000143',
   'Generator 5kVA #1', 'unit', '11111111-1111-1111-1111-111111110143');

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_table('public', 'equipment_movements', 'equipment_movements exists');
select has_type('public', 'equipment_movement_kind', 'equipment_movement_kind enum exists');
select col_is_pk('public', 'equipment_movements', 'id', 'equipment_movements.id is the PK');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.equipment_movements'::regclass),
  'RLS enabled on equipment_movements');

-- ============================================================================
-- B. CHECK invariants (as table owner — RLS bypassed, the CHECK fires).
-- ============================================================================
select throws_ok(
  $$ insert into public.equipment_movements (item_id, kind, project_id, created_by)
     values ('d0000001-0000-4000-8000-000000000143', 'deployed', null,
             '11111111-1111-1111-1111-111111110143') $$,
  '23514', null, 'deployed requires a project_id');
select throws_ok(
  $$ insert into public.equipment_movements (item_id, kind, project_id, created_by)
     values ('d0000001-0000-4000-8000-000000000143', 'received',
             'cc000001-0000-4000-8000-000000000143', '11111111-1111-1111-1111-111111110143') $$,
  '23514', null, 'a non-deployed movement cannot carry a project_id');
select throws_ok(
  $$ insert into public.equipment_movements (item_id, kind, project_id, quantity, created_by)
     values ('d0000001-0000-4000-8000-000000000143', 'deployed',
             'cc000001-0000-4000-8000-000000000143', 0, '11111111-1111-1111-1111-111111110143') $$,
  '23514', null, 'quantity must be >= 1');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- C. Staff INSERT + created_by pin (authenticated = site_admin: the field moves gear).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220143"}';

select lives_ok(
  $$ insert into public.equipment_movements (item_id, kind, project_id, occurred_at, created_by)
     values ('d0000001-0000-4000-8000-000000000143', 'deployed',
             'cc000001-0000-4000-8000-000000000143', '2026-07-05',
             '22222222-2222-2222-2222-222222220143') $$,
  'site_admin records a deploy-to-project movement');
select throws_ok(
  $$ insert into public.equipment_movements (item_id, kind, project_id, created_by)
     values ('d0000001-0000-4000-8000-000000000143', 'deployed',
             'cc000001-0000-4000-8000-000000000143', '11111111-1111-1111-1111-111111110143') $$,
  '42501', null, 'created_by must equal the caller (pin)');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330143"}';
select throws_ok(
  $$ insert into public.equipment_movements (item_id, kind, project_id, created_by)
     values ('d0000001-0000-4000-8000-000000000143', 'deployed',
             'cc000001-0000-4000-8000-000000000143', '33333333-3333-3333-3333-333333330143') $$,
  '42501', null, 'a visitor cannot record a movement');

-- ============================================================================
-- D. Status-derive trigger.
-- ============================================================================
reset role;
select is(
  (select status::text from public.equipment_items
    where id = 'd0000001-0000-4000-8000-000000000143'),
  'on_site', 'a deployed movement derives equipment_items.status = on_site');

-- A later return clears the deployment (recorded as owner here; the trigger fires
-- on every insert regardless of who records it).
insert into public.equipment_movements (item_id, kind, project_id, occurred_at, created_by)
values ('d0000001-0000-4000-8000-000000000143', 'returned', null, '2026-07-09',
        '11111111-1111-1111-1111-111111110143');
select is(
  (select status::text from public.equipment_items
    where id = 'd0000001-0000-4000-8000-000000000143'),
  'returned', 'a returned movement derives equipment_items.status = returned');

-- ============================================================================
-- E. Append-only: no UPDATE / DELETE for authenticated.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220143"}';
select throws_ok(
  $$ update public.equipment_movements set quantity = 2
     where item_id = 'd0000001-0000-4000-8000-000000000143' $$,
  '42501', null, 'movements cannot be updated (append-only)');
select throws_ok(
  $$ delete from public.equipment_movements
     where item_id = 'd0000001-0000-4000-8000-000000000143' $$,
  '42501', null, 'movements cannot be deleted (append-only)');

-- ============================================================================
-- F. Anon denial + a final positive SELECT count for staff.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ select id from public.equipment_movements limit 1 $$,
  '42501', null, 'anon cannot read equipment_movements');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220143"}';
select is(
  (select count(*)::int from public.equipment_movements
    where item_id = 'd0000001-0000-4000-8000-000000000143'),
  2, 'staff sees the two recorded movements (deployed + returned)');

reset role;
select * from finish();
rollback;
