begin;
select plan(12);

-- enum type exists with the twelve expected values
select has_type('public', 'user_role', 'user_role enum exists');
select enum_has_labels(
  'public', 'user_role',
  array['site_admin', 'project_manager', 'super_admin', 'project_coordinator', 'procurement', 'technician', 'hr', 'subcon_manager', 'accounting', 'visitor', 'contractor', 'project_director'],
  'user_role has the twelve expected values'
);

-- table shape
select has_table('public', 'users', 'public.users exists');
select col_is_pk('public', 'users', 'id', 'id is primary key');
select col_type_is('public', 'users', 'id', 'uuid', 'id is uuid');
select col_type_is('public', 'users', 'role', 'user_role', 'role is user_role');
select col_not_null('public', 'users', 'role', 'role is NOT NULL');
select col_has_default('public', 'users', 'role', 'role has a default');
select col_default_is(
  'public', 'users', 'role', 'visitor'::user_role,
  'role defaults to visitor'
);

-- foreign key to auth.users
select fk_ok(
  'public', 'users', 'id',
  'auth', 'users', 'id',
  'public.users.id references auth.users.id'
);

-- RLS is enabled
select is(
  (select relrowsecurity from pg_class where oid = 'public.users'::regclass),
  true,
  'RLS enabled on public.users'
);

-- trigger on auth.users insert exists
select has_trigger(
  'auth', 'users', 'on_auth_user_created',
  'on_auth_user_created trigger exists on auth.users'
);

select * from finish();
rollback;
