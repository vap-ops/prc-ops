begin;
select plan(18);

-- ============================================================================
-- Spec 279 F2b — "log who invited who". The SA's per-project self-onboard QR
-- (spec 279 F2a) carries ?project + ?by; when the ช่าง scans it and registers,
-- start_staff_registration captures those as invited_project_id + invited_by on
-- the staging row, so the approver sees เชิญโดย: <SA> and the site pre-fills.
--
-- Trust: these two refs are VISITOR-SUPPLIED (from a URL) → UNVERIFIED, ADVISORY
-- only. They never drive an authz decision (the approver still confirms + the
-- workers.project_id binding is set by the approver's p_project_id at approve
-- time). The DEFINER RPC existence-COERCES a bad/forged uuid to NULL so a
-- mis-scanned QR never blocks a legitimate applicant's registration.
--
-- Covers:
--  * columns invited_by / invited_project_id (uuid, nullable, FK ON DELETE SET NULL)
--  * start_staff_registration re-signatured (text,text,text,uuid,uuid) — old
--    3-arg overload dropped; anon/public re-revoked on the NEW signature
--  * valid refs persist; bogus refs coerce to NULL (registration still succeeds);
--    the no-invite (defaulted) call still works and stores NULLs.
-- ============================================================================

-- --- Actors + fixtures ------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0282-0282-0282-a00000000282', 'sa@s282.local',       '{}'::jsonb),  -- inviting SA (invited_by target)
  ('a1000000-0282-0282-0282-a10000000282', 'appValid@s282.local', '{}'::jsonb),  -- applicant: valid invite refs
  ('a2000000-0282-0282-0282-a20000000282', 'appBogus@s282.local', '{}'::jsonb),  -- applicant: bogus refs → coerce null
  ('a3000000-0282-0282-0282-a30000000282', 'appNone@s282.local',  '{}'::jsonb);  -- applicant: no invite (defaults)
update public.users set role='site_admin' where id='a0000000-0282-0282-0282-a00000000282';

insert into public.projects (id, code, name) values
  ('a9000000-0282-0282-0282-a90000000282', 'TAP-282', 'Spec 282 fixture project');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure — new columns + re-signatured RPC + anon-exec posture.
-- ============================================================================
select has_column('public', 'staff_registrations', 'invited_by', 'invited_by column added');
select col_type_is('public', 'staff_registrations', 'invited_by', 'uuid', 'invited_by is uuid');
select has_column('public', 'staff_registrations', 'invited_project_id', 'invited_project_id column added');
select col_type_is('public', 'staff_registrations', 'invited_project_id', 'uuid', 'invited_project_id is uuid');

select is(
  (select c.confdeltype from pg_constraint c
     where c.conrelid='public.staff_registrations'::regclass and c.contype='f'
       and 'invited_by' = (select a.attname from pg_attribute a
                             where a.attrelid=c.conrelid and a.attnum=c.conkey[1])),
  'n', 'invited_by FK is ON DELETE SET NULL');
select is(
  (select c.confdeltype from pg_constraint c
     where c.conrelid='public.staff_registrations'::regclass and c.contype='f'
       and 'invited_project_id' = (select a.attname from pg_attribute a
                                     where a.attrelid=c.conrelid and a.attnum=c.conkey[1])),
  'n', 'invited_project_id FK is ON DELETE SET NULL');

select has_function('public', 'start_staff_registration', array['text','text','text','uuid','uuid'],
  'start_staff_registration re-signatured (text,text,text,uuid,uuid)');
select hasnt_function('public', 'start_staff_registration', array['text','text','text'],
  'old 3-arg start_staff_registration overload is GONE (dropped, not left dangling)');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='start_staff_registration'
      and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on start_staff_registration (re-revoked on new signature)');
select function_privs_are('public', 'start_staff_registration',
  array['text','text','text','uuid','uuid'],
  'authenticated', array['EXECUTE'], 'authenticated can execute the re-signatured start_staff_registration');

-- ============================================================================
-- Behaviour — valid refs persist.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0282-0282-0282-a10000000282"}';
select lives_ok(
  $$ select public.start_staff_registration('ช่าง ถูกต้อง', '0810000001', null,
       'a0000000-0282-0282-0282-a00000000282', 'a9000000-0282-0282-0282-a90000000282') $$,
  'visitor registers via a QR carrying a valid invited_by + invited_project_id');
reset role;
select is((select invited_by from public.staff_registrations where user_id='a1000000-0282-0282-0282-a10000000282'),
  'a0000000-0282-0282-0282-a00000000282'::uuid, 'invited_by persisted (the SA)');
select is((select invited_project_id from public.staff_registrations where user_id='a1000000-0282-0282-0282-a10000000282'),
  'a9000000-0282-0282-0282-a90000000282'::uuid, 'invited_project_id persisted (the project)');

-- ============================================================================
-- Behaviour — bogus (non-existent) refs coerce to NULL; registration succeeds.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000000-0282-0282-0282-a20000000282"}';
select lives_ok(
  $$ select public.start_staff_registration('ช่าง มั่ว', '0810000002', null,
       'dead0000-0000-0000-0000-000000000000', 'dead9999-0000-0000-0000-000000000000') $$,
  'a forged/mis-scanned QR (bogus refs) does NOT block registration');
reset role;
select is((select invited_by from public.staff_registrations where user_id='a2000000-0282-0282-0282-a20000000282'),
  null, 'bogus invited_by existence-coerced to NULL');
select is((select invited_project_id from public.staff_registrations where user_id='a2000000-0282-0282-0282-a20000000282'),
  null, 'bogus invited_project_id existence-coerced to NULL');

-- ============================================================================
-- Behaviour — the no-invite (defaulted) call path still works, stores NULLs.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3000000-0282-0282-0282-a30000000282"}';
select lives_ok(
  $$ select public.start_staff_registration('ช่าง ไร้ผู้เชิญ', '0810000003', 'ช่างไฟ') $$,
  'the 3-arg (no-invite) call path still works via defaults');
reset role;
select is(
  (select coalesce(invited_by::text,'NULL') || '/' || coalesce(invited_project_id::text,'NULL')
     from public.staff_registrations where user_id='a3000000-0282-0282-0282-a30000000282'),
  'NULL/NULL', 'a no-invite registration stores NULL invited_by + invited_project_id');

select * from finish();
rollback;
