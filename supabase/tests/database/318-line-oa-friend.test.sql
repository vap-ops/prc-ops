-- spec 318 U1 — users.line_oa_friend columns + unchanged grant posture.
begin;
select plan(5);

select has_column('public', 'users', 'line_oa_friend', 'users.line_oa_friend exists');
select col_type_is('public', 'users', 'line_oa_friend', 'boolean', 'line_oa_friend is boolean');
select has_column(
  'public', 'users', 'line_oa_friend_checked_at', 'users.line_oa_friend_checked_at exists'
);
select col_type_is(
  'public', 'users', 'line_oa_friend_checked_at', 'timestamp with time zone',
  'checked_at is timestamptz'
);

-- The flag is service-role-written (login callback); the column add must not
-- open a client write path.
select ok(
  not has_table_privilege('authenticated', 'public.users', 'UPDATE'),
  'authenticated still has no UPDATE on users'
);

select * from finish();
rollback;
