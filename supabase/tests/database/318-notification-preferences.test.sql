-- spec 318 U3 — notification_preferences posture + RPC behavior.
-- Fixture-scoped (never table-wide counts — live rows exist in prod).
begin;
select plan(15);

-- table + posture
select has_table('public', 'notification_preferences', 'table exists');
select col_is_pk(
  'public', 'notification_preferences', array['user_id', 'event_type'], 'pk (user_id, event_type)'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.notification_preferences'::regclass),
  'RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.notification_preferences', 'SELECT'),
  'authenticated may SELECT (own-rows policy scopes it)'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_preferences', 'INSERT'),
  'authenticated cannot INSERT directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_preferences', 'UPDATE'),
  'authenticated cannot UPDATE directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_preferences', 'DELETE'),
  'authenticated cannot DELETE directly'
);
select ok(
  not has_table_privilege('anon', 'public.notification_preferences', 'SELECT'),
  'anon has nothing'
);
select ok(
  not has_function_privilege(
    'anon', 'public.set_notification_preference(public.notification_event_type, boolean)', 'EXECUTE'
  ),
  'anon cannot execute the RPC'
);

-- fixtures: two authed users (second pins cross-user read isolation)
insert into auth.users (id, email)
values
  ('00000000-0000-4318-a000-000000000001', 'spec318u3@test.local'),
  ('00000000-0000-4318-a000-000000000002', 'spec318u3b@test.local')
on conflict (id) do nothing;
insert into public.users (id, role)
values
  ('00000000-0000-4318-a000-000000000001', 'site_admin'),
  ('00000000-0000-4318-a000-000000000002', 'site_admin')
on conflict (id) do update set role = 'site_admin';

-- the OTHER user has a mute row (owner-write via service path is fine here:
-- the isolation under test is the READ policy)
insert into public.notification_preferences (user_id, event_type, enabled)
values ('00000000-0000-4318-a000-000000000002', 'wp_decision', false);

-- assertions run while role=authenticated → the runner's _tap_buf collector
-- needs explicit grants (see memory pgtap-tapbuf-grant-role-switch / PR #400)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- act as the fixture user
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4318-a000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.set_notification_preference('pr_progress', false)$$,
  'fixture user can mute pr_progress'
);
select results_eq(
  $$select enabled from public.notification_preferences
    where user_id = '00000000-0000-4318-a000-000000000001' and event_type = 'pr_progress'$$,
  array[false],
  'mute row visible to owner with enabled=false'
);
select lives_ok(
  $$select public.set_notification_preference('pr_progress', true)$$,
  'upsert flips the same row back on'
);
select results_eq(
  $$select enabled from public.notification_preferences
    where user_id = '00000000-0000-4318-a000-000000000001' and event_type = 'pr_progress'$$,
  array[true],
  'row now enabled=true (single row upserted)'
);
select throws_ok(
  $$select public.set_notification_preference('site_issue_reported', false)$$,
  '22023',
  'notification event is locked',
  'safety alert refuses mute'
);
select results_eq(
  $$select count(*)::int from public.notification_preferences
    where user_id = '00000000-0000-4318-a000-000000000002'$$,
  array[0],
  'another user''s preference rows are invisible (own-rows read policy)'
);

reset role;

select * from finish();
rollback;
