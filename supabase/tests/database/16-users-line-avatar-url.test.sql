begin;
select plan(3);

-- ============================================================================
-- Spec 08 / ADR 0020: users.line_avatar_url column added by migration
-- 20260608000000_add_line_avatar_url.sql
-- ============================================================================

-- Column exists
select has_column(
  'public', 'users', 'line_avatar_url',
  'public.users.line_avatar_url column exists'
);

-- Type is text
select col_type_is(
  'public', 'users', 'line_avatar_url', 'text',
  'line_avatar_url is type text'
);

-- Nullable (no NOT NULL constraint — LINE picture is optional)
select col_is_null(
  'public', 'users', 'line_avatar_url',
  'line_avatar_url is nullable'
);

select * from finish();
rollback;
