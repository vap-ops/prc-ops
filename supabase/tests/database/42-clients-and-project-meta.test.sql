begin;
select plan(40);

-- ============================================================================
-- Spec 79 — clients master + project metadata (client/lead/type/budget/dates),
-- set_project_client RPC, and the extended update_project_settings (10-arg).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('79000000-0000-0000-0000-0000000000a1', 'sa@s79.local',      '{}'::jsonb),
  ('79000000-0000-0000-0000-0000000000b2', 'pm@s79.local',      '{}'::jsonb),
  ('79000000-0000-0000-0000-0000000000c3', 'super@s79.local',   '{}'::jsonb),
  ('79000000-0000-0000-0000-0000000000d4', 'visitor@s79.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '79000000-0000-0000-0000-0000000000a1';
update public.users set role = 'project_manager' where id = '79000000-0000-0000-0000-0000000000b2';
update public.users set role = 'super_admin'     where id = '79000000-0000-0000-0000-0000000000c3';
-- d4 keeps default 'visitor'.

-- Fixtures (owner context bypasses RLS).
insert into public.projects (id, code, name, status) values
  ('79111111-1111-1111-1111-111111111111', 'PRC-TEST-79', 'S79 fixture project', 'active');
insert into public.clients (id, name, created_by) values
  ('79222222-2222-2222-2222-222222222222', 'ลูกค้าทดสอบ',
   '79000000-0000-0000-0000-0000000000b2');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---- A. Structure / catalog / security (owner context) ---------------------

select has_type('public', 'project_type', 'project_type enum exists');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'project_type'),
  array['new_building','renovation','factory_warehouse','infrastructure','systems','other'],
  'project_type has exactly the six operator-chosen values, in order');

select has_table('public', 'clients', 'clients table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.clients'::regclass),
  true, 'clients has RLS enabled');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'clients' and cmd = 'DELETE'),
  0, 'clients has NO delete policy (ADR 0033)');

-- Spec 81 — clients note column (rides the existing UPDATE policy/grant).
select has_column('public', 'clients', 'note', 'spec 81: clients.note exists');
select col_is_null('public', 'clients', 'note', 'spec 81: clients.note is nullable');
select col_type_is('public', 'clients', 'note', 'text', 'spec 81: clients.note is text');
select throws_ok(
  $$ insert into public.clients (name, note, created_by)
     values ('ยาวเกิน', repeat('x', 2001), '79000000-0000-0000-0000-0000000000b2') $$,
  '23514', null, 'spec 81: note > 2000 violates clients_note_len');
select is(has_column_privilege('authenticated', 'public.clients', 'note', 'INSERT'),
  true, 'spec 81: authenticated may INSERT clients.note');
select is(has_column_privilege('authenticated', 'public.clients', 'note', 'UPDATE'),
  true, 'spec 81: authenticated may UPDATE clients.note');

select is(
  has_column_privilege('authenticated', 'public.projects', 'budget_amount_thb', 'SELECT'),
  false, 'budget_amount_thb SELECT is revoked from authenticated (money isolation)');

select has_column('public', 'projects', 'client_id',       'projects.client_id exists');
select has_column('public', 'projects', 'project_lead_id', 'projects.project_lead_id exists');
select has_column('public', 'projects', 'project_type',    'projects.project_type exists');

-- CHECK constraints reject bad values (owner direct insert; constraint fires).
select throws_ok(
  $$ insert into public.projects (code, name, site_address)
     values ('PRC-79-A', 'x', repeat('z', 256)) $$,
  '23514', null, 'site_address > 255 chars rejected by CHECK');
select throws_ok(
  $$ insert into public.projects (code, name, budget_amount_thb)
     values ('PRC-79-B', 'x', -1) $$,
  '23514', null, 'negative budget rejected by CHECK');
select throws_ok(
  $$ insert into public.projects (code, name, start_date, planned_completion_date)
     values ('PRC-79-C', 'x', '2026-06-01', '2026-01-01') $$,
  '23514', null, 'completion before start rejected by CHECK');

select is(
  (select prosecdef from pg_proc
    where proname = 'set_project_client' and pronamespace = 'public'::regnamespace),
  true, 'set_project_client is SECURITY DEFINER');
select ok(
  (select 'search_path=public' = any(proconfig) from pg_proc
    where proname = 'set_project_client' and pronamespace = 'public'::regnamespace),
  'set_project_client pins search_path = public');

-- ---- B. Role-sim behavior --------------------------------------------------

set local role authenticated;

-- PM assigns the client.
set local "request.jwt.claims" = '{"sub": "79000000-0000-0000-0000-0000000000b2"}';
select is(
  public.set_project_client('79111111-1111-1111-1111-111111111111',
                            '79222222-2222-2222-2222-222222222222'),
  true, 'PM assigns a client to the project');
-- Unknown client returns false (no exception).
select is(
  public.set_project_client('79111111-1111-1111-1111-111111111111',
                            '79222222-2222-2222-2222-2222222229ff'),
  false, 'set_project_client: unknown client returns false');
-- Unknown project returns false.
select is(
  public.set_project_client('79111111-1111-1111-1111-1111111119ff',
                            '79222222-2222-2222-2222-222222222222'),
  false, 'set_project_client: unknown project returns false');

-- SA cannot call set_project_client.
set local "request.jwt.claims" = '{"sub": "79000000-0000-0000-0000-0000000000a1"}';
select throws_ok(
  $$ select public.set_project_client('79111111-1111-1111-1111-111111111111', null) $$,
  '42501', null, 'site_admin cannot call set_project_client');

-- PM sets the full metadata set via the 10-arg RPC.
set local "request.jwt.claims" = '{"sub": "79000000-0000-0000-0000-0000000000b2"}';
select is(
  public.update_project_settings(
    '79111111-1111-1111-1111-111111111111', 'S79 fixture project', 'active',
    null,                                   -- notes
    '123 ถนนทดสอบ',                         -- site_address
    '2026-12-31',                           -- planned_completion_date
    1500000,                                -- budget
    '2026-06-01',                           -- start_date
    '79000000-0000-0000-0000-0000000000c3', -- project_lead_id (super)
    'renovation'),                          -- project_type
  true, 'PM sets site_address/dates/budget/lead/type via the RPC');

-- Past completion date rejected.
select throws_ok(
  $$ select public.update_project_settings(
       '79111111-1111-1111-1111-111111111111', 'x', 'active',
       null, null, '2000-01-01') $$,
  '22023', null, 'past completion date raises 22023');
-- Negative budget rejected.
select throws_ok(
  $$ select public.update_project_settings(
       '79111111-1111-1111-1111-111111111111', 'x', 'active',
       null, null, null, -5) $$,
  '22023', null, 'negative budget raises 22023');
-- Unknown project lead rejected.
select throws_ok(
  $$ select public.update_project_settings(
       '79111111-1111-1111-1111-111111111111', 'x', 'active',
       null, null, null, null, null, '79000000-0000-0000-0000-0000000009ff') $$,
  '22023', null, 'unknown project lead raises 22023');

-- clients master RLS: PM inserts; SA cannot; staff read; visitor sees none.
select lives_ok(
  $$ insert into public.clients (name, created_by)
     values ('ลูกค้าใหม่โดย PM', '79000000-0000-0000-0000-0000000000b2') $$,
  'PM inserts a client (created_by pinned)');

-- spec 81: PM edits a client note (the masters-management write path, no RPC).
select lives_ok(
  $$ update public.clients set note = 'ลูกค้ารายใหญ่ ติดต่อผ่านเลขา'
     where id = '79222222-2222-2222-2222-222222222222' $$,
  'spec 81: PM updates a client note via the existing UPDATE policy');

set local "request.jwt.claims" = '{"sub": "79000000-0000-0000-0000-0000000000a1"}';
select throws_ok(
  $$ insert into public.clients (name, created_by)
     values ('ลูกค้าโดย SA', '79000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'site_admin cannot insert a client');
select cmp_ok(
  (select count(*)::int from public.clients), '>=', 1,
  'site_admin can SELECT clients (staff read)');

set local "request.jwt.claims" = '{"sub": "79000000-0000-0000-0000-0000000000d4"}';
select is(
  (select count(*)::int from public.clients), 0,
  'visitor sees no clients (SELECT policy excludes)');

reset role;

-- ---- C. Outcomes (owner context can read money) ----------------------------

select is(
  (select site_address from public.projects
    where id = '79111111-1111-1111-1111-111111111111'),
  '123 ถนนทดสอบ', 'site_address landed (trimmed)');
select is(
  (select budget_amount_thb from public.projects
    where id = '79111111-1111-1111-1111-111111111111'),
  1500000::numeric(12,2), 'budget landed');
select is(
  (select project_type from public.projects
    where id = '79111111-1111-1111-1111-111111111111'),
  'renovation'::public.project_type, 'project_type landed');
select is(
  (select project_lead_id from public.projects
    where id = '79111111-1111-1111-1111-111111111111'),
  '79000000-0000-0000-0000-0000000000c3'::uuid, 'project_lead_id landed');
select is(
  (select client_id from public.projects
    where id = '79111111-1111-1111-1111-111111111111'),
  '79222222-2222-2222-2222-222222222222'::uuid, 'client_id landed from set_project_client');
select is(
  (select contract_reference from public.projects
    where id = '79111111-1111-1111-1111-111111111111'),
  null::text, 'contract_reference is NOT writable by the RPC (immutable from app)');

select is(
  (select note from public.clients
     where id = '79222222-2222-2222-2222-222222222222'),
  'ลูกค้ารายใหญ่ ติดต่อผ่านเลขา',
  'spec 81: PM client-note update landed');

select * from finish();
rollback;
