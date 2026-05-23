begin;
select plan(7);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses RLS).
--    Insert two auth.users rows; the on_auth_user_created trigger creates
--    matching public.users rows with default role 'visitor' (ADR 0010). Then
--    promote one to 'super_admin' and the other to 'site_admin' so the
--    role-visibility tests below have stable subjects.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'super@rls-test.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'site@rls-test.local',  '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '00000000-0000-0000-0000-000000000001';
update public.users set role = 'site_admin'
  where id = '00000000-0000-0000-0000-000000000002';

-- Grant the runner's temp result buffer (created automatically right after
-- begin;) to authenticated, so the assertions that run under `set local role
-- authenticated` can still record their TAP output via the runner's
-- `insert into _tap_buf(line) select <pgtap>` transform.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog assertions (run as postgres; no jwt context required).
-- ============================================================================

select has_function(
  'public', 'current_user_role', '{}'::name[],
  'public.current_user_role() exists'
);

select ok(
  (select prosecdef from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname = 'current_user_role'),
  'current_user_role() is SECURITY DEFINER'
);

-- ============================================================================
-- C. Direct function tests — set the jwt claim and call current_user_role()
--    directly. The function bypasses RLS via SECURITY DEFINER, so it works
--    regardless of the caller's role; we don't need to switch role for these.
--
--    Using the JSON `request.jwt.claims` form (modern/durable). Supabase's
--    auth.uid() reads this and falls back to the legacy single-key form, so
--    setting either works; the JSON form is preferred against version drift.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000001"}';
select is(
  public.current_user_role(),
  'super_admin'::public.user_role,
  'current_user_role() returns super_admin for the super-admin uuid'
);

set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000002"}';
select is(
  public.current_user_role(),
  'site_admin'::public.user_role,
  'current_user_role() returns site_admin for the site-admin uuid'
);

-- ============================================================================
-- D. RLS recursion REGRESSION GUARD + role-visibility checks. Must run under
--    the `authenticated` role so RLS is engaged (postgres bypasses RLS via
--    BYPASSRLS). After this point, all assertion inserts hit _tap_buf as
--    authenticated — hence the grants above.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000002"}';

-- D.1 LOAD-BEARING: the exact SELECT shape that previously raised
--     "infinite recursion detected in policy for relation users" must now
--     succeed. This is the regression guard for ADR 0011.
select lives_ok(
  $$ select 1 from public.users where id = '00000000-0000-0000-0000-000000000002'::uuid $$,
  'authenticated SELECT on public.users does not recurse (ADR 0011 regression guard)'
);

-- D.2 super_admin (uuid-1) sees both test rows via the super_admin policy.
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000001"}';
select is(
  (select count(*)::int from public.users
     where id in (
       '00000000-0000-0000-0000-000000000001'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid
     )),
  2,
  'super_admin sees both test rows'
);

-- D.3 non-super (site_admin) sees only its own row via the self-read policy.
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000002"}';
select is(
  (select count(*)::int from public.users
     where id in (
       '00000000-0000-0000-0000-000000000001'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid
     )),
  1,
  'non-super (site_admin) sees only own row'
);

-- ============================================================================
-- E. Tear down. Drop back to the outer role BEFORE finish() / the runner's
--    injected dump from _tap_buf, so those run as postgres. pgTAP assertion
--    functions catch internal failures and emit "not ok" lines rather than
--    raising, so this reset is always reached. The rollback at the end also
--    discards every `set local` change — this reset is belt-and-suspenders.
-- ============================================================================

reset role;

select * from finish();
rollback;
