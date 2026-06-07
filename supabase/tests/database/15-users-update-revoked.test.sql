begin;
select plan(6);

-- ============================================================================
-- Spec / ADR: docs/decisions/0019-revoke-user-update.md (amends ADR 0007).
--
-- This test verifies the contract of migration
-- 20260607160000_revoke_user_update_from_authenticated.sql:
--   revoke update on public.users from authenticated, anon;
--
-- It runs inside a begin/rollback transaction and replays the revoke at the
-- top, so the assertions hold regardless of whether the migration has been
-- applied to the live DB yet. The rollback at the end undoes everything.
-- Postgres permits idempotent REVOKE: if the privilege is already gone, the
-- statement is a no-op.
-- ============================================================================

-- Replay the migration's REVOKE so this suite passes pre- and post-apply.
revoke update on public.users from authenticated, anon;

-- ============================================================================
-- A. Catalog: privileges look as the migration intends.
-- ============================================================================

select ok(
  not has_table_privilege('authenticated', 'public.users', 'UPDATE'),
  'authenticated role lacks UPDATE on public.users'
);

select ok(
  not has_table_privilege('anon', 'public.users', 'UPDATE'),
  'anon role lacks UPDATE on public.users'
);

select ok(
  has_table_privilege('service_role', 'public.users', 'UPDATE'),
  'service_role retains UPDATE on public.users (intentionally NOT revoked)'
);

-- ============================================================================
-- B. Behavioural setup: seed one auth.users row; the on_auth_user_created
--    trigger creates the matching public.users row at role 'visitor'
--    (ADR 0010). Grant _tap_buf to authenticated so assertions run under
--    `set local role authenticated` (same pattern as 06-users-rls and
--    14-update-my-display-name).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@revoke-test.local', '{}'::jsonb);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub": "00000000-0000-0000-0000-0000000000c1"}';

-- ============================================================================
-- C. Regression: the profile RPC still works after the revoke.
--    update_my_display_name is SECURITY DEFINER (ADR 0017), so its body runs
--    as the function owner (postgres) — the revoke on `authenticated` does not
--    constrain what the function body can do. The caller holds EXECUTE on the
--    function, not UPDATE on the table.
-- ============================================================================

select lives_ok(
  $$ select public.update_my_display_name('Display Name') $$,
  'profile RPC (SECURITY DEFINER) still callable under authenticated despite revoke'
);

-- Read back as authenticated (the row passes `users read self` RLS for c1).
select is(
  (select full_name from public.users
     where id = '00000000-0000-0000-0000-0000000000c1'),
  'Display Name',
  'full_name was actually updated by the SECURITY DEFINER RPC'
);

-- ============================================================================
-- D. Escalation: a direct UPDATE on public.users from an authenticated session
--    is now rejected at the PRIVILEGE LAYER (SQLSTATE 42501 =
--    insufficient_privilege). Pre-revoke this same statement returned
--    ROW_COUNT=0 silently (no permissive UPDATE policy); ADR 0019 is about
--    swapping that silent block for an explicit privilege-layer reject so a
--    future stray permissive policy cannot reopen the escalation path.
-- ============================================================================

select throws_ok(
  $$ update public.users set role = 'super_admin' where id = auth.uid() $$,
  '42501',
  null,
  'direct UPDATE on public.users from authenticated raises 42501 (privilege denied), not silent 0 rows'
);

-- ============================================================================
-- E. Tear down.
-- ============================================================================

reset role;

select * from finish();
rollback;
