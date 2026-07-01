begin;
select plan(13);

-- ============================================================================
-- Spec 244 U1 / ADR 0068 (amended) — interaction_events, the Tier-B client
-- telemetry sink (session/screen-time + friction). Append-only-ish but
-- RETENTION-managed (not the audit_log triple-lock). Identity is tamper-proof:
-- a BEFORE INSERT trigger stamps actor_id = auth.uid() and actor_role =
-- current_user_role(), so a client cannot spoof who/what-role an event is.
-- RLS: authenticated inserts land as themselves; SELECT = super_admin (the
-- v1 support reader) OR the subject's own rows (self-mirror, PDPA). No user
-- UPDATE/DELETE (retention deletes run as the definer prune fn only).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000244', 'sa_a@tel.local', '{}'::jsonb),
  ('bb000000-0000-4000-8000-000000000244', 'sa_b@tel.local', '{}'::jsonb),
  ('55000000-0000-4000-8000-000000000244', 'super@tel.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = 'aa000000-0000-4000-8000-000000000244';
update public.users set role = 'site_admin'  where id = 'bb000000-0000-4000-8000-000000000244';
update public.users set role = 'super_admin' where id = '55000000-0000-4000-8000-000000000244';

-- structure
select has_table('public', 'interaction_events', 'interaction_events table exists');
select has_function('public', 'prune_interaction_events', 'retention prune fn exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.interaction_events'::regclass),
  'RLS is enabled on interaction_events');

-- Let assertions run while impersonating a user (the runner collects each
-- assertion into _tap_buf; grant it to authenticated first — crew-test pattern).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ── as SA "A": insert own event ──────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000244"}';

select lives_ok(
  $$ insert into public.interaction_events (session_id, event_type, route)
     values ('sess-a1', 'session_start', '/sa') $$,
  'SA can insert its own interaction event');

-- trigger stamps identity: even if the caller supplies someone else's id / a
-- lied role, the stored row is the real caller as site_admin.
insert into public.interaction_events (actor_id, actor_role, session_id, event_type, route)
  values ('bb000000-0000-4000-8000-000000000244', 'super_admin', 'sess-a2', 'heartbeat', '/sa');
select is(
  (select count(*)::int from public.interaction_events
     where actor_id = 'aa000000-0000-4000-8000-000000000244'),
  2, 'both inserts are stamped to the real caller A (supplied B-id ignored)');
select is(
  (select actor_role::text from public.interaction_events where session_id = 'sess-a2'),
  'site_admin', 'actor_role is stamped from the real role, not the supplied lie');

-- A sees only its own rows
select is(
  (select count(*)::int from public.interaction_events),
  2, 'A selects only its own rows (self-mirror)');

-- A cannot UPDATE or DELETE (no privilege / no policy)
select throws_ok(
  $$ update public.interaction_events set route = '/x' where session_id = 'sess-a1' $$,
  '42501', NULL, 'authenticated cannot UPDATE interaction_events');
select throws_ok(
  $$ delete from public.interaction_events where session_id = 'sess-a1' $$,
  '42501', NULL, 'authenticated cannot DELETE interaction_events');

-- ── as SA "B": inserts own; does NOT see A's rows ─────────────────────────
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000244"}';
insert into public.interaction_events (session_id, event_type, route)
  values ('sess-b1', 'session_start', '/sa');
select is(
  (select count(*)::int from public.interaction_events),
  1, 'B sees only its own row, never A''s (no cross-subject read)');

-- isolation holds both ways: back as A, B's later row is still invisible.
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000244"}';
select is(
  (select count(*)::int from public.interaction_events),
  2, 'A still sees only its own 2 rows after B inserted (isolation both ways)');

-- ── as super_admin: sees everyone's rows (the support reader) ─────────────
set local "request.jwt.claims" = '{"sub": "55000000-0000-4000-8000-000000000244"}';
select is(
  (select count(*)::int from public.interaction_events),
  3, 'super_admin reads all interaction events (A×2 + B×1)');

-- ── anon cannot insert ────────────────────────────────────────────────────
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ insert into public.interaction_events (session_id, event_type, route)
     values ('sess-anon', 'session_start', '/sa') $$,
  NULL, NULL, 'anon / unbound caller cannot insert');

reset role;
select * from finish();
rollback;
