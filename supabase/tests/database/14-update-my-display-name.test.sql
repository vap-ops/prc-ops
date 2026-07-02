begin;
select plan(13);

-- ============================================================================
-- Spec: docs/feature-specs/05-profile-management.md
-- ADR:  docs/decisions/0017-profile-self-edit.md
--
-- A. Setup as postgres (BYPASSRLS).
--    Insert two auth.users rows; the on_auth_user_created trigger creates
--    matching public.users rows with role 'visitor' (ADR 0010). We leave
--    both at 'visitor' so the role-unchanged escalation guard has a clean
--    "before" value to compare against.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@profile-test.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@profile-test.local', '{}'::jsonb);

-- Seed an initial full_name for A so the audit payload's `from` field has
-- a real value to compare. B is left NULL.
update public.users
   set full_name = 'Old Name'
 where id = '00000000-0000-0000-0000-0000000000a1';

-- Grant the runner's _tap_buf to authenticated so assertions can record
-- TAP output under `set local role authenticated` (same as 06-users-rls).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog assertions (postgres role; no jwt context required).
-- ============================================================================

-- 1. function exists with the documented (text) signature
select has_function(
  'public', 'update_my_display_name', array['text']::name[],
  'public.update_my_display_name(text) exists'
);

-- 2. SECURITY DEFINER
select ok(
  (select prosecdef from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname = 'update_my_display_name'),
  'update_my_display_name is SECURITY DEFINER'
);

-- 3. search_path pinned to public
select ok(
  (select proconfig from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname = 'update_my_display_name')
    @> array['search_path=public'],
  'update_my_display_name has search_path pinned to public'
);

-- 4. EXECUTE granted to authenticated
select ok(
  has_function_privilege('authenticated',
    'public.update_my_display_name(text)', 'EXECUTE'),
  'authenticated holds EXECUTE on update_my_display_name'
);

-- 5. EXECUTE revoked from public (PUBLIC pseudo-role).
--    has_function_privilege('public', ...) is not a thing; check the
--    catalog directly. After REVOKE EXECUTE ... FROM public, no ACL
--    entry should grant EXECUTE to PUBLIC (grantee = 0 in aclitem).
select ok(
  not exists (
    select 1 from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'update_my_display_name'
       and a.grantee = 0      -- 0 = PUBLIC
       and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE on update_my_display_name (revoked)'
);

-- ============================================================================
-- C. Behavioural tests under `authenticated`. Engage RLS so the function's
--    SECURITY DEFINER hop is the one that grants write privilege — the
--    session itself has none on public.users.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub": "00000000-0000-0000-0000-0000000000a1"}';

-- 6. Happy path: A calls the RPC with a name surrounded by whitespace.
--    The trim must apply and the stored value must equal the trimmed form.
select lives_ok(
  $$ select public.update_my_display_name('  New Name  ') $$,
  'authenticated session can call update_my_display_name'
);

select is(
  (select full_name from public.users
     where id = '00000000-0000-0000-0000-0000000000a1'),
  'New Name',
  'full_name is updated to the trimmed value'
);

-- 7. Escalation guard: the role must be unchanged after the call.
select is(
  (select role from public.users
     where id = '00000000-0000-0000-0000-0000000000a1'),
  'visitor'::public.user_role,
  'role is UNCHANGED after update_my_display_name (escalation guard)'
);

-- 8. Other-user untouched: A's call must not have touched B's row.
--    Read B as postgres (RLS would hide it from A); reset role briefly.
reset role;
select is(
  (select full_name from public.users
     where id = '00000000-0000-0000-0000-0000000000a2'),
  NULL,
  'other user (B) row is untouched by A''s call'
);
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub": "00000000-0000-0000-0000-0000000000a1"}';

-- 9. Empty after trim must raise. ADR 0017 uses errcode '22023'
--    (invalid_parameter_value).
select throws_ok(
  $$ select public.update_my_display_name('   ') $$,
  '22023',
  'display name must not be empty',
  'whitespace-only input raises 22023'
);

-- 10. >80 chars must raise. ADR 0017 uses errcode '22001'
--     (string_data_right_truncation). 81 'a' chars.
select throws_ok(
  $$ select public.update_my_display_name(repeat('a', 81)) $$,
  '22001',
  'display name must be 80 characters or fewer',
  '>80 chars input raises 22001'
);

-- 11. Audit row was appended for the successful happy-path call.
--     Expect exactly one row for A with action='profile_update',
--     target_table='users', target_id=A.
--     Read as the OWNER: audit_log SELECT is scoped to privileged internal
--     roles (rls-audit-2026-07 F2) — a visitor session sees no audit rows.
reset role;
select is(
  (select count(*)::int from public.audit_log
     where actor_id = '00000000-0000-0000-0000-0000000000a1'
       and action = 'profile_update'
       and target_table = 'users'
       and target_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'exactly one audit_log row appended for the successful call'
);

-- 12. Audit payload carries from/to with the trimmed value.
select is(
  (select payload from public.audit_log
     where actor_id = '00000000-0000-0000-0000-0000000000a1'
       and action = 'profile_update'
     order by created_at desc
     limit 1),
  jsonb_build_object('field', 'full_name', 'from', 'Old Name', 'to', 'New Name'),
  'audit payload has {field, from, to} with trimmed value'
);

-- ============================================================================
-- D. Tear down.
-- ============================================================================

reset role;

select * from finish();
rollback;
