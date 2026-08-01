-- Spec 388 U1 — a ช่าง reads their OWN muster attendance.
--
-- The live finding this file exists to pin (checked 2026-08-01, and it is the
-- whole reason the reader is an RPC rather than a query):
--
--   `muster_attendance` carries exactly ONE select policy —
--   "muster attendance readable in visible projects", keyed on
--   can_see_project(team.project_id) — and that function's body falls to
--   `else false` for `technician`. It admits super_admin / project_coordinator /
--   project_director / procurement_manager outright, and project_manager /
--   site_admin / site_owner / auditor by project membership. A ช่าง is in
--   neither arm, so a bound worker cannot read a single row of their own
--   attendance. Section B asserts that gap directly: if someone later widens
--   can_see_project, this test reds and the widening gets re-justified rather
--   than silently making the RPC redundant.
--
-- Section C carries a POSITIVE control beside the negative one. "The caller
-- sees no other worker's rows" is equally consistent with "the filter works"
-- and "the function returns nothing at all", so the same caller must also be
-- shown to get their OWN rows back in the same role context.

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- principals: two bound ช่าง (A and B) + one technician bound to no worker row
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000038a1','att-tech-a@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000038a2','att-tech-b@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000038a3','att-unbound@t.local','{}'::jsonb);
update public.users set role='technician' where id in (
  '00000000-0000-0000-0000-0000000038a1',
  '00000000-0000-0000-0000-0000000038a2',
  '00000000-0000-0000-0000-0000000038a3');

-- fixture project + workers + teams (RLS bypassed for setup)
-- projects has no created_by column (code + name are its only NOT NULL columns
-- without a default) — the first draft assumed one and died as a file-level
-- ERROR, which reports as a red with no assertion names at all.
insert into public.projects (id, code, name) values
  ('00000000-0000-0000-0000-0000000038b0','PRJ-388','โครงการทดสอบ 388');

insert into public.workers (id, name, user_id, created_by) values
  ('00000000-0000-0000-0000-0000000038c1','ช่างเอ','00000000-0000-0000-0000-0000000038a1',
   '00000000-0000-0000-0000-0000000038a1'),
  ('00000000-0000-0000-0000-0000000038c2','ช่างบี','00000000-0000-0000-0000-0000000038a2',
   '00000000-0000-0000-0000-0000000038a1');

insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('00000000-0000-0000-0000-0000000038d1','00000000-0000-0000-0000-0000000038b0',
   date '2026-07-30','00000000-0000-0000-0000-0000000038c1','00000000-0000-0000-0000-0000000038a1'),
  ('00000000-0000-0000-0000-0000000038d2','00000000-0000-0000-0000-0000000038b0',
   date '2026-07-31','00000000-0000-0000-0000-0000000038c1','00000000-0000-0000-0000-0000000038a1');

-- A: two sessions on ONE date (spec 351 — regular AND ot coexist) + an earlier
-- date, so ordering and the dual-session case are both exercised.
-- B: one row on a date A never worked, so a leak is unambiguous.
-- scanned_by is NOT NULL (the muster is scanned BY someone — that is the whole
-- point of in_method='manual'), so every fixture row carries the scanner.
insert into public.muster_attendance
  (team_id, worker_id, work_date, in_at, in_method, out_at, out_method, out_auto,
   ot_hours, session, scanned_by)
values
  ('00000000-0000-0000-0000-0000000038d2','00000000-0000-0000-0000-0000000038c1',
   date '2026-07-31', timestamptz '2026-07-31 01:02:00+00','qr',
   timestamptz '2026-07-31 10:00:00+00','qr', false, 0, 'regular',
   '00000000-0000-0000-0000-0000000038a1'),
  ('00000000-0000-0000-0000-0000000038d2','00000000-0000-0000-0000-0000000038c1',
   date '2026-07-31', timestamptz '2026-07-31 10:25:00+00','qr',
   timestamptz '2026-07-31 13:30:00+00','manual', true, 3, 'ot',
   '00000000-0000-0000-0000-0000000038a1'),
  ('00000000-0000-0000-0000-0000000038d1','00000000-0000-0000-0000-0000000038c1',
   date '2026-07-30', timestamptz '2026-07-30 01:10:00+00','manual',
   null, null, false, 0, 'regular',
   '00000000-0000-0000-0000-0000000038a1'),
  ('00000000-0000-0000-0000-0000000038d1','00000000-0000-0000-0000-0000000038c2',
   date '2026-07-30', timestamptz '2026-07-30 01:15:00+00','qr',
   timestamptz '2026-07-30 10:00:00+00','qr', false, 0, 'regular',
   '00000000-0000-0000-0000-0000000038a1');

-- ===========================================================================
-- A. The reader exists, is DEFINER, and its ACL is the house shape.
-- ===========================================================================
select has_function('public', 'get_my_attendance', 'get_my_attendance() exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_attendance'),
  true,
  'get_my_attendance is SECURITY DEFINER (technician fails can_see_project, so RLS cannot serve it)'
);

select is(
  has_function_privilege('authenticated', 'public.get_my_attendance()', 'EXECUTE'),
  true,
  'authenticated may execute it (it self-scopes on the workers.user_id binding)'
);

-- has_function_privilege resolves PUBLIC through role inheritance, so an anon
-- false here also proves no default PUBLIC EXECUTE grant survived. (A count over
-- information_schema.role_routine_grants would NOT — that view has no PUBLIC arm
-- and reads "safe" whether or not PUBLIC holds the grant.)
select is(
  has_function_privilege('anon', 'public.get_my_attendance()', 'EXECUTE'),
  false,
  'anon (and therefore PUBLIC) cannot execute get_my_attendance'
);

-- allow role switches to write TAP (the _tap_buf grant trap)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000038a1"}';

-- ===========================================================================
-- B. The gap the RPC exists to close — a direct read returns NOTHING for a
--    ช่าง, even though this caller's own rows demonstrably exist (seeded above
--    and proved readable through the RPC in section C).
-- ===========================================================================
select is(
  (select count(*)::int from public.muster_attendance),
  0,
  'a technician reads ZERO rows of muster_attendance directly (can_see_project → else false)'
);

-- ===========================================================================
-- C. Self-scope: the positive control and the negative control, same caller,
--    same role context.
-- ===========================================================================
select is(
  (select count(*)::int from public.get_my_attendance()),
  3,
  'POSITIVE CONTROL: ช่าง A gets their own 3 rows back (so an empty negative below means filtered, not broken)'
);

select is(
  (select count(*)::int from public.get_my_attendance() where work_date = date '2026-07-30'),
  1,
  'NEGATIVE CONTROL: only A''s own row on the shared date — B worked it too and does not appear'
);

select is(
  (select count(*)::int from public.get_my_attendance() where work_date = date '2026-07-31'),
  2,
  'both sessions of one date are returned, not collapsed (spec 351: regular AND ot)'
);

-- Pins the RPC's own emitted order, not an alphabetical re-sort: within a day
-- the sessions must read in the order they happened (regular, then OT), which
-- is why the ORDER BY mixes work_date DESC with in_at ASC.
select is(
  (select string_agg(session, ',' order by ord) from (
     select session, row_number() over () as ord from public.get_my_attendance()
      where work_date = date '2026-07-31'
   ) s),
  'regular,ot',
  'the session discriminator survives the RPC, and a day reads regular-then-OT'
);

select is(
  (select array_agg(work_date order by ord) from (
     select work_date, row_number() over () as ord from public.get_my_attendance()
   ) s),
  array[date '2026-07-31', date '2026-07-31', date '2026-07-30'],
  'rows arrive newest work_date first'
);

select is(
  (select distinct project_name from public.get_my_attendance()),
  'โครงการทดสอบ 388',
  'the project name is joined through (the view model renders it per row)'
);

-- ===========================================================================
-- D. A caller with no workers row gets nothing — the unbound arm. Without the
--    explicit null guard this is still empty (a null equality matches nothing),
--    but the guard is what makes that intentional rather than incidental.
-- ===========================================================================
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000038a3"}';

select is(
  (select count(*)::int from public.get_my_attendance()),
  0,
  'a technician bound to no workers row gets zero rows, not everyone else''s'
);

select * from finish();
rollback;
