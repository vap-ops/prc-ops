begin;
select plan(22);

-- ============================================================================
-- Spec 244 U5 / ADR 0068 (amended, Tier B) — get_actor_timeline: the per-person
-- activity-timeline RPC behind /settings/usage/[actorId]. Groups the heartbeat-
-- dominated interaction_events slice into per-session rows server-side (a raw
-- PostgREST read would truncate at the page cap): started_at / last_seen_at /
-- duration_ms (heartbeats × 20s, the refresh_usage_daily proxy) / screens
-- (route_view sequence) / friction (the 5 friction types), newest session first.
-- SECURITY INVOKER on purpose: RLS scopes the read — super_admin gets any actor,
-- a subject gets only their own rows (self-mirror), cross-subject reads return
-- ZERO rows. Tests: structure, grants, the grouping math, ordering, and the
-- invoker RLS scoping.
--
-- Fixture timestamps are now()-relative: now() is transaction-stable, so exact
-- comparisons hold, and the RPC's window is relative to now() (a pinned past
-- day would fall outside it). Assertions scope by the fixture actors' uuids, so
-- live production events never pollute the counts. Everything rolls back.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000255', 'sa_a@tl.local', '{}'::jsonb),
  ('bb000000-0000-4000-8000-000000000255', 'sa_b@tl.local', '{}'::jsonb),
  ('55000000-0000-4000-8000-000000000255', 'super@tl.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = 'aa000000-0000-4000-8000-000000000255';
update public.users set role = 'site_admin'  where id = 'bb000000-0000-4000-8000-000000000255';
update public.users set role = 'super_admin' where id = '55000000-0000-4000-8000-000000000255';

-- structure + grants
select has_function('public', 'get_actor_timeline', 'get_actor_timeline RPC exists');
select ok(
  (select not prosecdef from pg_proc
    where oid = 'public.get_actor_timeline(uuid, integer)'::regprocedure),
  'get_actor_timeline is SECURITY INVOKER (RLS scopes the read)');
select is(
  has_function_privilege('anon', 'public.get_actor_timeline(uuid, integer)', 'execute'),
  false, 'anon cannot EXECUTE get_actor_timeline');
select is(
  has_function_privilege('authenticated', 'public.get_actor_timeline(uuid, integer)', 'execute'),
  true, 'authenticated can EXECUTE get_actor_timeline (invoker + RLS make it safe)');

-- Let assertions run while impersonating a user (the runner collects each
-- assertion into _tap_buf; grant it to authenticated first — crew-test pattern).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ── seed raw events as SA "A" (trigger stamps actor_id = A) ────────────────
-- session u5-t1 (2h ago): start + 3 heartbeats + 2 route_views + 1 js_error
--   => duration 60000ms, screens [/sa/photos, /sa/wp], friction [js_error].
-- session u5-t2 (1h ago): start + 1 heartbeat => duration 20000ms; its two
-- route_views (added below) share one created_at to pin the client_ts tiebreak.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000255"}';
insert into public.interaction_events (session_id, event_type, route, created_at) values
  ('u5-t1', 'session_start', '/sa',        now() - interval '2 hours'),
  ('u5-t1', 'heartbeat',     '/sa',        now() - interval '2 hours' + interval '20 seconds'),
  ('u5-t1', 'heartbeat',     '/sa',        now() - interval '2 hours' + interval '40 seconds'),
  ('u5-t1', 'heartbeat',     '/sa',        now() - interval '2 hours' + interval '60 seconds'),
  ('u5-t1', 'route_view',    '/sa/photos', now() - interval '2 hours' + interval '70 seconds'),
  ('u5-t1', 'js_error',      '/sa/photos', now() - interval '2 hours' + interval '75 seconds'),
  ('u5-t1', 'route_view',    '/sa/wp',     now() - interval '2 hours' + interval '80 seconds'),
  ('u5-t2', 'session_start', '/sa',        now() - interval '1 hour'),
  ('u5-t2', 'heartbeat',     '/sa',        now() - interval '1 hour' + interval '20 seconds');

-- Batched ingest gives every event in one flush an IDENTICAL created_at (one
-- multi-row INSERT; now() is transaction-stable), so created_at alone cannot
-- order screens within a batch — client_ts (device time) is the tiebreaker.
-- Insert the LATER screen first so physical/index order alone fails the assert.
insert into public.interaction_events (session_id, event_type, route, created_at, client_ts) values
  ('u5-t2', 'route_view', '/sa/second',
     now() - interval '1 hour' + interval '30 seconds',
     now() - interval '1 hour' + interval '26 seconds'),
  ('u5-t2', 'route_view', '/sa/first',
     now() - interval '1 hour' + interval '30 seconds',
     now() - interval '1 hour' + interval '25 seconds');

-- ── seed raw events as SA "B" (1 session) ──────────────────────────────────
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000255"}';
insert into public.interaction_events (session_id, event_type, route, created_at) values
  ('u5-t3', 'session_start', '/sa', now() - interval '30 minutes'),
  ('u5-t3', 'heartbeat',     '/sa', now() - interval '30 minutes' + interval '20 seconds');

-- ── as super_admin: reads any actor; grouping math + ordering ──────────────
set local "request.jwt.claims" = '{"sub": "55000000-0000-4000-8000-000000000255"}';
select is(
  (select count(*)::int from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255')),
  2, 'super_admin reads A''s timeline: 2 sessions');
select is(
  (select t.session_id from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    limit 1),
  'u5-t2', 'sessions are ordered newest-first (u5-t2 before u5-t1)');
select is(
  (select t.duration_ms from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  60000::bigint, 'u5-t1 duration_ms = 3 heartbeats * 20000ms');
select is(
  (select t.duration_ms from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t2'),
  20000::bigint, 'u5-t2 duration_ms = 1 heartbeat * 20000ms');
select is(
  (select t.started_at from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  now() - interval '2 hours', 'started_at = min(created_at) of the session');
select is(
  (select t.last_seen_at from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  now() - interval '2 hours' + interval '80 seconds',
  'last_seen_at = max(created_at) of the session');
select is(
  (select t.screens->0->>'route'
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t2'),
  '/sa/first', 'same-created_at screens order by the client_ts tiebreaker (1st)');
select is(
  (select t.screens->1->>'route'
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t2'),
  '/sa/second', 'same-created_at screens order by the client_ts tiebreaker (2nd)');
select is(
  (select jsonb_array_length(t.screens)
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  2, 'u5-t1 screens carries the 2 route_view events (heartbeats excluded)');
select is(
  (select t.screens->0->>'route'
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  '/sa/photos', 'screens are in visit order (first = /sa/photos)');
select is(
  (select t.screens->1->>'route'
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  '/sa/wp', 'screens are in visit order (second = /sa/wp)');
select is(
  (select jsonb_array_length(t.friction)
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  1, 'u5-t1 friction carries the js_error event');
select is(
  (select t.friction->0->>'type'
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255') t
    where t.session_id = 'u5-t1'),
  'js_error', 'friction entries carry the event type');
select is(
  (select count(*)::int from public.get_actor_timeline('00000000-0000-4000-8000-000000000255')),
  0, 'an actor with no events yields an empty timeline (no error)');
select is(
  (select count(*)::int
     from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255', 9999)),
  2, 'an oversized p_days is clamped (no error; recent events still in window)');

-- ── as SA "A": self-mirror read only; cross-subject returns ZERO rows ───────
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000255"}';
select is(
  (select count(*)::int from public.get_actor_timeline('aa000000-0000-4000-8000-000000000255')),
  2, 'a subject reads their OWN timeline (self-mirror)');
select is(
  (select count(*)::int from public.get_actor_timeline('bb000000-0000-4000-8000-000000000255')),
  0, 'a subject gets ZERO rows for another actor (invoker RLS, no cross-read)');

-- ── as SA "B": own timeline only ────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000255"}';
select is(
  (select count(*)::int from public.get_actor_timeline('bb000000-0000-4000-8000-000000000255')),
  1, 'B reads B: 1 session');

reset role;
select * from finish();
rollback;
