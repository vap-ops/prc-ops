begin;
select plan(22);

-- ============================================================================
-- Spec 397 U4 — the office muster team.
--
-- Office staff and a visiting auditor are present on site but are not a ช่าง in a
-- crew. They ride the EXISTING muster (a workers row at day_rate 0 books no wage —
-- derive_muster_labor's cost gate), so what is missing is only a way to say "this
-- team is the office one".
--
-- A team KIND, not a naming convention: `muster_teams.kind` (`crew` | `office`,
-- default `crew`), ONE office team per project × date enforced by a partial unique
-- index, and `open_muster_team` takes the kind.
--
-- ⚠️ The lead is NULLABLE for an office team and required for a crew one. Zero
-- `site_owner` users exist today (the spec's intended lead), and a team that
-- cannot open until an appointment lands is a team nobody can check into. The
-- existing UNIQUE (project, date, lead) cannot dedupe office teams for exactly
-- that reason — NULLs are distinct — which is why the partial index exists.
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0397-4444-4444-000000000009', 'super@s397u4.local', '{}'::jsonb),
  ('70000000-0397-4444-4444-00000000000d', 'sa@s397u4.local',    '{}'::jsonb),
  ('70000000-0397-4444-4444-0000000000fe', 'probe@s397u4.local', '{}'::jsonb);
update public.users set role = 'super_admin' where id = '70000000-0397-4444-4444-000000000009';
update public.users set role = 'site_admin'  where id = '70000000-0397-4444-4444-00000000000d';

insert into public.projects (id, code, name) values
  ('a1000000-0397-4444-4444-000000000001', 'TAP-397U4', 'โครงการยูโฟร์');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0397-4444-4444-000000000001', '70000000-0397-4444-4444-00000000000d',
   '70000000-0397-4444-4444-000000000009');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-0397-4444-4444-000000000001', 'หัวหน้าชุด', 'daily', 'temporary', 400, true,
   '70000000-0397-4444-4444-000000000009'),
  -- The office attendee: rate 0, cost unconfirmed — provably wage-free.
  ('e2000000-0397-4444-4444-000000000002', 'ธุรการ หนึ่ง', 'monthly', 'permanent', 0, true,
   '70000000-0397-4444-4444-000000000009');

-- ============================================================================
-- A. The kind itself
-- ============================================================================
select has_type('public', 'muster_team_kind', 'the muster_team_kind enum exists');
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'muster_team_kind'),
  'crew,office', 'it has exactly crew,office in that order');
select has_column('public', 'muster_teams', 'kind', 'muster_teams.kind exists');
select col_not_null('public', 'muster_teams', 'kind', 'kind is NOT NULL');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'muster_teams' and column_name = 'kind'),
  '''crew''::muster_team_kind', 'it defaults to crew — every existing row and caller is a crew team');

-- The 44 live teams predate this column; the default is what backfilled them, and
-- an office team appearing among them would mean the migration mislabelled real
-- crew work. Scoped to rows created BEFORE this test's fixtures.
select is(
  (select count(*)::int from public.muster_teams
    where kind = 'office' and project_id <> 'a1000000-0397-4444-4444-000000000001'),
  0, 'no pre-existing team was backfilled as office');

-- ============================================================================
-- B. One office team per project-day (the partial unique index)
-- ============================================================================
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'muster_teams'
       and indexdef ilike '%unique%' and indexdef ilike '%kind%' and indexdef ilike '%office%'
  ),
  'a partial unique index covers the office team');

insert into public.muster_teams (project_id, work_date, lead_worker_id, kind, created_by) values
  ('a1000000-0397-4444-4444-000000000001', '2026-07-01', null, 'office',
   '70000000-0397-4444-4444-000000000009');
select throws_ok(
  $$insert into public.muster_teams (project_id, work_date, lead_worker_id, kind, created_by)
    values ('a1000000-0397-4444-4444-000000000001', '2026-07-01', null, 'office',
            '70000000-0397-4444-4444-000000000009')$$,
  '23505', null, 'a SECOND office team on the same project-day is refused');
-- …while two LEADLESS crew teams are not the index's business (the pre-existing
-- UNIQUE cannot dedupe them either — NULLs are distinct — but crew teams always
-- carry a lead, which open_muster_team enforces).
select lives_ok(
  $$insert into public.muster_teams (project_id, work_date, lead_worker_id, kind, created_by)
    values ('a1000000-0397-4444-4444-000000000001', '2026-07-02', null, 'office',
            '70000000-0397-4444-4444-000000000009')$$,
  'a different DATE gets its own office team');

-- ============================================================================
-- C. open_muster_team takes the kind
-- ============================================================================
select has_function('public', 'open_muster_team', array['uuid', 'date', 'uuid', 'muster_team_kind'],
  'open_muster_team(project, date, lead, kind) exists');
-- The 3-arg form is GONE, not left beside the new one: two overloads would make
-- PostgREST resolve by argument names, and a caller omitting p_kind would be
-- ambiguous rather than defaulted.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'open_muster_team'),
  1, 'exactly ONE open_muster_team overload survives');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-4444-4444-00000000000d"}';

-- ⚠️ The call must be its OWN statement. Calling it inside a `where id = fn(...)`
-- ran the insert but read against the statement's own snapshot, so the freshly
-- inserted row was invisible and the assert saw NULL — which the leadless case
-- would then have "passed" vacuously (NULL is NULL).
create temp table u4_ids as
select public.open_muster_team(
         'a1000000-0397-4444-4444-000000000001'::uuid, '2026-07-03'::date,
         'e1000000-0397-4444-4444-000000000001'::uuid) as crew_id,
       public.open_muster_team(
         'a1000000-0397-4444-4444-000000000001'::uuid, '2026-07-04'::date, null,
         'office'::public.muster_team_kind) as office_id;
grant select on u4_ids to authenticated;

-- Existing callers pass three arguments and must keep working, as a CREW team.
select is(
  (select kind::text from public.muster_teams where id = (select crew_id from u4_ids)),
  'crew', 'a three-argument call still opens a CREW team (the default)');

select is(
  (select kind::text from public.muster_teams where id = (select office_id from u4_ids)),
  'office', 'an office team opens with NO lead worker');
-- Non-vacuous: the row EXISTS (the id resolves) and its lead is null.
select is(
  (select count(*)::int from public.muster_teams
    where id = (select office_id from u4_ids) and lead_worker_id is null),
  1, 'the office team is real and leadless');

-- Idempotent: opening the same office day again returns the SAME team.
create temp table u4_again as
select public.open_muster_team(
         'a1000000-0397-4444-4444-000000000001'::uuid, '2026-07-04'::date, null,
         'office'::public.muster_team_kind) as office_id;
grant select on u4_again to authenticated;
select is(
  (select office_id from u4_again), (select office_id from u4_ids),
  'reopening the same office day returns the SAME team, not a second one');

select is(
  (select count(*)::int from public.muster_teams
    where project_id = 'a1000000-0397-4444-4444-000000000001'
      and work_date = '2026-07-04' and kind = 'office'),
  1, '…and it did NOT create a second office team for that day');

-- A crew team still REQUIRES its lead: that is what makes the cockpit's grouping
-- safe, and it is why only the office kind may be leadless.
select throws_ok(
  $$select public.open_muster_team('a1000000-0397-4444-4444-000000000001'::uuid,
      '2026-07-05'::date, null, 'crew'::public.muster_team_kind)$$,
  'P0001', null, 'a crew team with no lead is still refused');
select throws_ok(
  $$select public.open_muster_team('a1000000-0397-4444-4444-000000000001'::uuid,
      '2026-07-05'::date, '00000000-0000-0000-0000-000000000000'::uuid,
      'crew'::public.muster_team_kind)$$,
  'P0001', null, 'an unknown lead worker is still refused');
reset role;

-- ============================================================================
-- D. The gate did not change, and neither did the scan path
-- ============================================================================
update public.users set role = 'technician' where id = '70000000-0397-4444-4444-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-4444-4444-0000000000fe"}';
select throws_ok(
  $$select public.open_muster_team('a1000000-0397-4444-4444-000000000001'::uuid,
      '2026-07-06'::date, null, 'office'::public.muster_team_kind)$$,
  '42501', null, 'technician still may not open a team, office or otherwise');
reset role;

-- An office attendee scans in exactly like anyone else — the whole point of
-- riding the existing muster rather than inventing a second store.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-4444-4444-00000000000d"}';
select lives_ok(
  $$select public.muster_scan_in(
      (select id from public.muster_teams
        where project_id = 'a1000000-0397-4444-4444-000000000001'
          and work_date = '2026-07-04' and kind = 'office'),
      'e2000000-0397-4444-4444-000000000002'::uuid, 'manual'::public.muster_method,
      'regular'::public.muster_session)$$,
  'an office worker checks into the office team through the normal scan RPC');
reset role;

set local role postgres;
select is(
  (select count(*)::int from public.muster_attendance a
     join public.muster_teams t on t.id = a.team_id
    where t.kind = 'office' and a.worker_id = 'e2000000-0397-4444-4444-000000000002'),
  1, 'the attendance row landed on the OFFICE team');

-- …and it is provably wage-free: derive_muster_labor books only when the worker
-- carries cost_confirmed_at AND day_rate > 0. This office worker has neither.
select is(
  (select count(*)::int from public.workers
    where id = 'e2000000-0397-4444-4444-000000000002'
      and cost_confirmed_at is null and day_rate = 0),
  1, 'the office attendee is wage-free by construction (rate 0, cost unconfirmed)');

select * from finish();
rollback;
