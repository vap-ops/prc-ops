begin;
select plan(18);

-- ============================================================================
-- Spec 244 U1b-2 / ADR 0068 (amended, Tier B) — usage_daily: the per-(actor,day)
-- rollup over interaction_events (the U1a sink) that produces the visible payoff:
-- DAU + per-SA screen time. Tests: structure, the refresh math (screen_time =
-- heartbeats * 20s, sessions = distinct session_id, opens = session_start count,
-- routes_touched = distinct route), idempotency, and RLS (super_admin reads all,
-- a subject reads only its own self-mirror row, no cross-subject read, no user
-- writes). Rollup is written only by refresh_usage_daily (SECURITY DEFINER),
-- never by an app client.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000250', 'sa_a@ud.local', '{}'::jsonb),
  ('bb000000-0000-4000-8000-000000000250', 'sa_b@ud.local', '{}'::jsonb),
  ('55000000-0000-4000-8000-000000000250', 'super@ud.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = 'aa000000-0000-4000-8000-000000000250';
update public.users set role = 'site_admin'  where id = 'bb000000-0000-4000-8000-000000000250';
update public.users set role = 'super_admin' where id = '55000000-0000-4000-8000-000000000250';

-- structure
select has_table('public', 'usage_daily', 'usage_daily rollup table exists');
select has_function('public', 'refresh_usage_daily', 'refresh_usage_daily fn exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.usage_daily'::regclass),
  'RLS is enabled on usage_daily');

-- Let assertions run while impersonating a user (the runner collects each
-- assertion into _tap_buf; grant it to authenticated first — crew-test pattern).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ── seed raw events as SA "A" (trigger stamps actor_id = A) ────────────────
-- session a1: 1 session_start + 3 heartbeats + 1 route_view; session a2: 1
-- session_start + 1 heartbeat.  => sessions 2, heartbeats 4, opens 2,
-- distinct routes {/sa, /sa/photos, /sa/wp} = 3.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000250"}';
insert into public.interaction_events (session_id, event_type, route) values
  ('u2-a1', 'session_start', '/sa'),
  ('u2-a1', 'heartbeat',     '/sa'),
  ('u2-a1', 'heartbeat',     '/sa'),
  ('u2-a1', 'heartbeat',     '/sa'),
  ('u2-a1', 'route_view',    '/sa/photos'),
  ('u2-a2', 'session_start', '/sa/wp'),
  ('u2-a2', 'heartbeat',     '/sa/wp');

-- ── seed raw events as SA "B" (1 session, 2 heartbeats) ────────────────────
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000250"}';
insert into public.interaction_events (session_id, event_type, route) values
  ('u2-b1', 'session_start', '/sa'),
  ('u2-b1', 'heartbeat',     '/sa'),
  ('u2-b1', 'heartbeat',     '/sa');

reset role;

-- ── refresh the rollup for today; upsert is idempotent ─────────────────────
select is(public.refresh_usage_daily(current_date), 2,
  'refresh_usage_daily upserts one row per active actor (A + B = 2)');
select is(public.refresh_usage_daily(current_date), 2,
  'refresh_usage_daily is idempotent (re-run still touches 2 rows)');

-- ── read the math as super_admin (RLS: the support reader sees all rows) ───
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55000000-0000-4000-8000-000000000250"}';
select is(
  (select sessions from public.usage_daily
     where actor_id = 'aa000000-0000-4000-8000-000000000250' and day = current_date),
  2, 'A sessions = distinct session_id (2)');
select is(
  (select screen_time_ms from public.usage_daily
     where actor_id = 'aa000000-0000-4000-8000-000000000250' and day = current_date),
  80000::bigint, 'A screen_time_ms = 4 heartbeats * 20000ms');
select is(
  (select opens from public.usage_daily
     where actor_id = 'aa000000-0000-4000-8000-000000000250' and day = current_date),
  2, 'A opens = session_start count (2)');
select is(
  (select routes_touched from public.usage_daily
     where actor_id = 'aa000000-0000-4000-8000-000000000250' and day = current_date),
  3, 'A routes_touched = distinct route (3)');
select is(
  (select active from public.usage_daily
     where actor_id = 'aa000000-0000-4000-8000-000000000250' and day = current_date),
  true, 'A active = true');
select is(
  (select screen_time_ms from public.usage_daily
     where actor_id = 'bb000000-0000-4000-8000-000000000250' and day = current_date),
  40000::bigint, 'B screen_time_ms = 2 heartbeats * 20000ms');
select is(
  (select count(*)::int from public.usage_daily where day = current_date),
  2, 'super_admin reads all usage_daily rows (A + B)');

-- ── as SA "A": self-mirror read only; never B's row; no writes ─────────────
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000250"}';
select is(
  (select count(*)::int from public.usage_daily),
  1, 'A reads only its own usage_daily row (self-mirror)');
select is(
  (select actor_id from public.usage_daily),
  'aa000000-0000-4000-8000-000000000250'::uuid,
  'the only row A can read is its own (no cross-subject leak)');
select throws_ok(
  $$ insert into public.usage_daily (actor_id, day)
     values ('aa000000-0000-4000-8000-000000000250', current_date) $$,
  '42501', NULL, 'authenticated cannot INSERT usage_daily (no write grant)');
select throws_ok(
  $$ update public.usage_daily set sessions = 99
       where actor_id = 'aa000000-0000-4000-8000-000000000250' $$,
  '42501', NULL, 'authenticated cannot UPDATE usage_daily');
-- and cannot EXECUTE the definer writer either (it bypasses RLS, so an accidental
-- re-grant would let any client forge/overwrite rollup rows) — writer-only.
select throws_ok(
  $$ select public.refresh_usage_daily(current_date) $$,
  '42501', NULL, 'authenticated cannot EXECUTE the definer writer refresh_usage_daily');

-- ── as SA "B": sees only its own row, never A's ────────────────────────────
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000250"}';
select is(
  (select count(*)::int from public.usage_daily),
  1, 'B reads only its own row, never A''s (no cross-subject read)');

reset role;
select * from finish();
rollback;
