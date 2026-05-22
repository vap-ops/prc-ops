begin;
select plan(2);

-- Insert into auth.users; the trigger should create the matching
-- public.users row with default role.
insert into auth.users (id, email, raw_user_meta_data)
  values (
    '00000000-0000-0000-0000-000000000001',
    'pgtap-test@example.com',
    '{}'::jsonb
  );

select results_eq(
  $$ select id, role::text from public.users
     where id = '00000000-0000-0000-0000-000000000001' $$,
  $$ values ('00000000-0000-0000-0000-000000000001'::uuid, 'visitor') $$,
  'trigger creates public.users row with default role'
);

-- Cascade delete removes public.users when auth.users row is deleted.
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';

select is_empty(
  $$ select 1 from public.users
     where id = '00000000-0000-0000-0000-000000000001' $$,
  'public.users row cascades on auth.users delete'
);

select * from finish();
rollback;
