-- spec 390 U1 — notification_channel_preferences posture + the reachability floor.
-- Fixture-scoped (never table-wide counts — live rows exist in prod).
--
-- The floor is the point of this file. A "you may not disable your last BOUND
-- channel" rule looks right and is wrong: LINE 403s a non-friend, so a user with
-- line_oa_friend = false is bound and unreachable. The three fixtures B/C differ
-- from A in exactly ONE column (line_oa_friend) so a green run cannot mean the
-- RPC simply refuses everything, and null-is-reachable is pinned separately
-- because it is the arm a later `= true` refactor silently inverts.
begin;
select plan(23);

-- posture
select has_table('public', 'notification_channel_preferences', 'table exists');
select col_is_pk(
  'public', 'notification_channel_preferences', array['user_id', 'channel'], 'pk (user_id, channel)'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.notification_channel_preferences'::regclass),
  'RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.notification_channel_preferences', 'SELECT'),
  'authenticated may SELECT (own-rows policy scopes it)'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_channel_preferences', 'INSERT'),
  'authenticated cannot INSERT directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_channel_preferences', 'UPDATE'),
  'authenticated cannot UPDATE directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_channel_preferences', 'DELETE'),
  'authenticated cannot DELETE directly'
);
select ok(
  not has_table_privilege('anon', 'public.notification_channel_preferences', 'SELECT'),
  'anon has nothing'
);
-- the house form: has_function_privilege resolves PUBLIC through role inheritance,
-- which role_routine_grants cannot (spec 363 U2a lesson).
select ok(
  not has_function_privilege(
    'anon', 'public.set_notification_channel_preference(public.notification_channel, boolean)', 'EXECUTE'
  ),
  'anon cannot execute the RPC'
);
-- string_agg rather than results_eq over the labels: enumlabel is `name`, and
-- comparing its cast against a text[] literal raises 42P22 (no determinable
-- collation) inside pgTAP's results_eq.
select is(
  (select string_agg(enumlabel::text, ',' order by enumsortorder)
     from pg_enum where enumtypid = 'public.notification_channel'::regtype),
  'line,telegram',
  'channel enum is exactly (line, telegram)'
);

-- fixtures. A/B/C are bound to BOTH channels and differ only in line_oa_friend.
insert into auth.users (id, email)
values
  ('00000000-0000-4390-a000-000000000001', 'spec390a@test.local'),
  ('00000000-0000-4390-a000-000000000002', 'spec390b@test.local'),
  ('00000000-0000-4390-a000-000000000003', 'spec390c@test.local'),
  ('00000000-0000-4390-a000-000000000004', 'spec390d@test.local'),
  ('00000000-0000-4390-a000-000000000005', 'spec390e@test.local')
on conflict (id) do nothing;

insert into public.users (id, role, line_user_id, telegram_chat_id, line_oa_friend)
values
  ('00000000-0000-4390-a000-000000000001', 'site_admin', 'Uspec390a', '390000001', true),
  ('00000000-0000-4390-a000-000000000002', 'site_admin', 'Uspec390b', '390000002', false),
  ('00000000-0000-4390-a000-000000000003', 'site_admin', 'Uspec390c', '390000003', null),
  ('00000000-0000-4390-a000-000000000004', 'site_admin', 'Uspec390d', '390000004', true),
  ('00000000-0000-4390-a000-000000000005', 'site_admin', 'Uspec390e', '390000005', true)
on conflict (id) do update set
  role = 'site_admin',
  line_user_id = excluded.line_user_id,
  telegram_chat_id = excluded.telegram_chat_id,
  line_oa_friend = excluded.line_oa_friend;

-- D reaches zero through two legal steps: LINE already off, then unlink Telegram.
-- E keeps a reachable enabled channel, so its row must SURVIVE the unlink.
insert into public.notification_channel_preferences (user_id, channel, enabled)
values
  ('00000000-0000-4390-a000-000000000004', 'line', false),
  ('00000000-0000-4390-a000-000000000005', 'telegram', false);

-- assertions run while role=authenticated → the runner's _tap_buf collector
-- needs explicit grants (memory pgtap-tapbuf-grant-role-switch / PR #400)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;

-- === A: line_oa_friend = true. Both channels reachable. ===
set local request.jwt.claims to '{"sub":"00000000-0000-4390-a000-000000000001","role":"authenticated"}';

-- POSITIVE CONTROL for the throws below: the first disable must SUCCEED.
select lives_ok(
  $$select public.set_notification_channel_preference('line', false)$$,
  'A may disable LINE while Telegram is reachable'
);
select results_eq(
  $$select enabled from public.notification_channel_preferences
    where user_id = '00000000-0000-4390-a000-000000000001' and channel = 'line'$$,
  array[false],
  'A''s LINE row is stored and visible to its owner'
);
select throws_ok(
  $$select public.set_notification_channel_preference('telegram', false)$$,
  '22023',
  'no reachable notification channel would remain',
  'A may NOT disable the last reachable channel'
);
select results_eq(
  $$select count(*)::int from public.notification_channel_preferences
    where user_id = '00000000-0000-4390-a000-000000000001' and channel = 'telegram'$$,
  array[0],
  'the refused disable stored nothing'
);
select lives_ok(
  $$select public.set_notification_channel_preference('line', true)$$,
  'A may always re-enable a channel'
);

-- === B: line_oa_friend = false. LINE is BOUND but cannot deliver. ===
set local request.jwt.claims to '{"sub":"00000000-0000-4390-a000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.set_notification_channel_preference('telegram', false)$$,
  '22023',
  'no reachable notification channel would remain',
  'B may NOT disable Telegram — a verified non-friend cannot be reached on LINE'
);
select lives_ok(
  $$select public.set_notification_channel_preference('line', false)$$,
  'B may still disable the channel that cannot reach them'
);

-- === C: line_oa_friend = null. Never probed is NOT unreachable. ===
set local request.jwt.claims to '{"sub":"00000000-0000-4390-a000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.set_notification_channel_preference('telegram', false)$$,
  'C may disable Telegram — a null friend flag counts as reachable'
);

-- === D: the two-legal-steps back door. Unlink must undo our own switch. ===
set local request.jwt.claims to '{"sub":"00000000-0000-4390-a000-000000000004","role":"authenticated"}';

select lives_ok(
  $$select public.unlink_telegram()$$,
  'D may unlink Telegram'
);
select results_eq(
  $$select count(*)::int from public.notification_channel_preferences
    where user_id = '00000000-0000-4390-a000-000000000004'$$,
  array[0],
  'unlink cleared D''s channel rows rather than stranding them at zero'
);

-- === E: unlink must NOT over-delete when a reachable channel remains. ===
set local request.jwt.claims to '{"sub":"00000000-0000-4390-a000-000000000005","role":"authenticated"}';

select lives_ok(
  $$select public.unlink_telegram()$$,
  'E may unlink Telegram'
);
select results_eq(
  $$select enabled from public.notification_channel_preferences
    where user_id = '00000000-0000-4390-a000-000000000005' and channel = 'telegram'$$,
  array[false],
  'E keeps its stated Telegram preference — LINE still reaches them, so nothing was stranded'
);

-- === read isolation ===
set local request.jwt.claims to '{"sub":"00000000-0000-4390-a000-000000000003","role":"authenticated"}';
select results_eq(
  $$select count(*)::int from public.notification_channel_preferences
    where user_id = '00000000-0000-4390-a000-000000000005'$$,
  array[0],
  'another user''s channel rows are invisible (own-rows read policy)'
);

reset role;

select * from finish();
rollback;
