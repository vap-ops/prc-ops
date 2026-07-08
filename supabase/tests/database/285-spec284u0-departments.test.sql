-- Spec 284 U0 / ADR 0080 — departments as open, non-gating org data.
-- Additive: `departments` table + seed + `users.department_id` + 3 super-only
-- DEFINER RPCs. Invariants asserted: seed shape, LABEL-ONLY (no RLS policy keys
-- off department_id), anon locked out, and the write RPCs FAIL-CLOSED for an
-- unbound (null-role) caller (the rls-self-check-coalesce trap).
begin;
select plan(12);

-- ---- schema ----------------------------------------------------------------
select has_table('public', 'departments', 'departments table exists');
select has_column('public', 'users', 'department_id', 'users.department_id column exists');

-- ---- seed ------------------------------------------------------------------
select is((select count(*)::int from public.departments), 8, '8 departments seeded');
select is((select count(*)::int from public.departments where is_active), 6, '6 active departments seeded');
select is((select is_active from public.departments where key = 'legal'), true, 'legal seeded, active');

-- ---- label-only invariant (ADR 0080 dec 3): NO policy keys off department_id
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') like '%department_id%' or coalesce(with_check, '') like '%department_id%')),
  0,
  'no RLS policy references department_id (departments are label-only)');

-- ---- anon locked out -------------------------------------------------------
select ok(
  not has_table_privilege('anon', 'public.departments', 'select'),
  'anon has no SELECT privilege on departments');

-- ---- write RPCs FAIL-CLOSED for a null-role caller (auth.uid() is null here)
select throws_ok(
  $$ select public.create_department('qa', 'คิวเอ', 'QA', 0) $$,
  '42501', null,
  'create_department is forbidden for an unbound (null-role) caller');
select throws_ok(
  $$ select public.set_user_department('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501', null,
  'set_user_department is forbidden for an unbound (null-role) caller');

-- ---- anon has NO EXECUTE on the write RPCs (the 075510 lock; invariant 229) --
select ok(not has_function_privilege('anon', 'public.create_department(text,text,text,int)', 'execute'),
  'anon has no EXECUTE on create_department');
select ok(not has_function_privilege('anon', 'public.set_department_head(uuid,uuid)', 'execute'),
  'anon has no EXECUTE on set_department_head');
select ok(not has_function_privilege('anon', 'public.set_user_department(uuid,uuid)', 'execute'),
  'anon has no EXECUTE on set_user_department');

select * from finish();
rollback;
