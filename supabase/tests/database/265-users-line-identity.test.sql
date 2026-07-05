begin;
select plan(10);

-- ============================================================================
-- Spec 265 U1 — super_admin LINE-identity visibility.
--
-- Two additive, nullable columns on public.users:
--   line_display_name text        — LINE-owned display name, refreshed EVERY login
--                                    (SEPARATE from the user-owned, NULL-only full_name)
--   line_synced_at    timestamptz — "last checked" time, stamped each login
--
-- Both are plain columns on users and inherit the row-level SELECT policies
-- (super_admin reads any row; every other role reads only its own). This test
-- pins:
--   A. the columns exist, are nullable, and are correctly typed;
--   B. the RLS read-scope on users is intact WITH the new columns in the SELECT
--      list (super_admin can read another user's row incl. the new columns; a
--      non-super_admin can read ONLY its own row);
--   C. no new GRANT/policy widened WRITE access on users — UPDATE stays revoked
--      from authenticated/anon (ADR 0019), so the callback's admin-client write
--      is the only write path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Column existence / nullability / type
-- ---------------------------------------------------------------------------
select has_column('public', 'users', 'line_display_name', 'users.line_display_name exists');
select col_type_is('public', 'users', 'line_display_name', 'text', 'line_display_name is text');
select col_is_null('public', 'users', 'line_display_name', 'line_display_name is nullable');

select has_column('public', 'users', 'line_synced_at', 'users.line_synced_at exists');
select col_type_is(
  'public', 'users', 'line_synced_at',
  'timestamp with time zone', 'line_synced_at is timestamptz');
select col_is_null('public', 'users', 'line_synced_at', 'line_synced_at is nullable');

-- ---------------------------------------------------------------------------
-- Setup: two auth.users rows (the on_auth_user_created trigger creates matching
-- public.users rows at role 'visitor', ADR 0010). Promote one super_admin and
-- one site_admin as stable subjects for the RLS read-scope assertions.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000002a1', 'super@li-test.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000002a2', 'site@li-test.local',  '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '00000000-0000-0000-0000-0000000002a1';
update public.users set role = 'site_admin'
  where id = '00000000-0000-0000-0000-0000000002a2';

-- Runner records TAP output via _tap_buf; grant it so assertions can run under
-- `set local role authenticated` (RLS engaged).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---------------------------------------------------------------------------
-- C. WRITE access is NOT widened — UPDATE on users stays revoked from
--    authenticated / anon (ADR 0019). Adding two columns must not add a grant.
-- ---------------------------------------------------------------------------
select is(
  has_table_privilege('authenticated', 'public.users', 'UPDATE'),
  false, 'authenticated has NO UPDATE on users (ADR 0019 preserved)');
select is(
  has_table_privilege('anon', 'public.users', 'UPDATE'),
  false, 'anon has NO UPDATE on users');

-- ---------------------------------------------------------------------------
-- B. RLS read-scope intact WITH the new columns in the SELECT list. Must run
--    under `authenticated` so RLS is engaged (postgres bypasses via BYPASSRLS).
-- ---------------------------------------------------------------------------
set local role authenticated;

-- B.1 super_admin reads ANOTHER user's row INCLUDING the two new columns.
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-0000000002a1"}';
select is(
  (select count(*)::int from public.users
     where id = '00000000-0000-0000-0000-0000000002a2'::uuid
       -- referencing the new columns forces them through the SELECT path
       and (line_display_name is null or line_display_name is not null)
       and (line_synced_at   is null or line_synced_at   is not null)),
  1,
  'super_admin can SELECT another user''s row incl. line_display_name + line_synced_at');

-- B.2 non-super (site_admin) reads ONLY its own row (the other row is invisible),
--     even when the new columns are in the SELECT list.
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-0000000002a2"}';
select is(
  (select count(*)::int from public.users
     where id in (
       '00000000-0000-0000-0000-0000000002a1'::uuid,
       '00000000-0000-0000-0000-0000000002a2'::uuid
     )
       and (line_display_name is null or line_display_name is not null)
       and (line_synced_at   is null or line_synced_at   is not null)),
  1,
  'non-super (site_admin) sees ONLY own row — new columns did not open a read path');

reset role;

select * from finish();
rollback;
