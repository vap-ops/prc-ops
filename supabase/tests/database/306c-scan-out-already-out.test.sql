begin;
select plan(17);

-- ============================================================================
-- Spec 306 §5 — muster_scan_out must REFUSE a worker who is already out.
--
-- The live function had no already-out guard: it ran
--   set out_at = now(), out_method = …, ot_hours = v_ot, out_auto = false
-- unconditionally, so a second scan on an already-closed session DESTROYED
-- three different values, not one:
--
--   ① out_at    — the real departure overwritten with the re-scan moment.
--   ② ot_hours  — an `ot` session is RE-PRICED from now() − in_at, so OT
--                 INFLATES on every extra scan. ⚠️ Display-only TODAY:
--                 derive_muster_labor does not read ot_hours and there is no
--                 ×1.5 anywhere (OT costing is deferred to 306 U5b). An earlier
--                 draft of this file called it a money bug — it is not, yet. It
--                 is a false number on the worker's own attendance screen that
--                 turns into wrong money the day U5b prices it.
--   ③ out_auto  — flips to false, silently converting an auto-closed day into
--                 a recorded departure and erasing the ปิดอัตโนมัติ signal that
--                 spec 388 U2 renders to the worker themselves.
--
-- It was reachable in production: three client sites hand-code the workaround
-- (muster-cockpit's partial-cure re-tap, sweep.ts's classifier twice,
-- actions.ts), each with a comment naming the missing guard — i.e. the rule
-- lived only at the affordance layer, written by hand, three times.
--
-- A guard alone would not have been enough. The row was read WITHOUT a lock, so
-- two concurrent scan-outs both saw out_at null and both wrote. The fix is the
-- refusal AND `for update`, which is why the concurrency shape is asserted here
-- rather than assumed.
--
-- Each destroyed value gets its own assertion on the VALUE, never merely on the
-- raised error: "it threw" does not prove "it preserved".
-- ============================================================================

-- The runner's collector is owned by postgres and these assertions fire under
-- `set local role authenticated` (the documented role-switch trap).
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

create temp table _ids (k text primary key, id uuid);
grant select, insert on _ids to authenticated, anon;
create temp table _ts (k text primary key, v timestamptz);
grant select, insert on _ts to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-306c-306c-306c-700000000306', 'sa@s306c.local',    '{}'::jsonb),
  ('75000000-306c-306c-306c-750000000306', 'super@s306c.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '70000000-306c-306c-306c-700000000306';
update public.users set role = 'super_admin' where id = '75000000-306c-306c-306c-750000000306';

insert into public.projects (id, code, name) values
  ('a1000000-306c-306c-306c-a10000000306', 'TAP-306C', 'โครงการทดสอบเช็คออกซ้ำ');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-306c-306c-306c-a10000000306', '70000000-306c-306c-306c-700000000306',
   '75000000-306c-306c-306c-750000000306');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-306c-306c-306c-e10000000306', 'หัวหน้า สามศูนย์หก', 'daily', 'temporary', 400, true,
   '75000000-306c-306c-306c-750000000306'),
  ('e2000000-306c-306c-306c-e20000000306', 'ช่าง ปกติ',   'daily', 'temporary', 400, true,
   '75000000-306c-306c-306c-750000000306'),
  ('e3000000-306c-306c-306c-e30000000306', 'ช่าง โอที',    'daily', 'temporary', 400, true,
   '75000000-306c-306c-306c-750000000306'),
  ('e4000000-306c-306c-306c-e40000000306', 'ช่าง ปิดอัตโนมัติ', 'daily', 'temporary', 400, true,
   '75000000-306c-306c-306c-750000000306'),
  ('e5000000-306c-306c-306c-e50000000306', 'ช่าง ยังไม่ออก', 'daily', 'temporary', 400, true,
   '75000000-306c-306c-306c-750000000306');

-- Seed the day through the REAL RPCs, as the member SA.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select public.open_muster_team('a1000000-306c-306c-306c-a10000000306', current_date,
  'e1000000-306c-306c-306c-e10000000306');
reset role;
insert into _ids select 'team', id from public.muster_teams
  where project_id = 'a1000000-306c-306c-306c-a10000000306' and work_date = current_date;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e2000000-306c-306c-306c-e20000000306', 'qr');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e3000000-306c-306c-306c-e30000000306', 'qr');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e3000000-306c-306c-306c-e30000000306', 'qr', 'ot');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e4000000-306c-306c-306c-e40000000306', 'qr');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e5000000-306c-306c-306c-e50000000306', 'qr');
reset role;

-- ============================================================================
-- A. POSITIVE CONTROL — the first scan-out still works.
--
--    Without this, every refusal below is equally consistent with "the RPC now
--    refuses everything", and the file would pass against a completely broken
--    function. Assert the effect, not just the absence of an error.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select lives_ok(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e2000000-306c-306c-306c-e20000000306', 'qr') $$,
  'the FIRST scan-out on an open regular session succeeds');
reset role;

select isnt(
  (select out_at from public.muster_attendance
    where worker_id = 'e2000000-306c-306c-306c-e20000000306'
      and work_date = current_date and session = 'regular'),
  null,
  'and it actually stamped out_at (the control has teeth)');

-- ⚠️ BACKDATE before recording, or the next assertion is VACUOUS — and it was:
-- the RED run passed it against the unguarded function. `now()` is the
-- TRANSACTION timestamp and pgTAP runs the whole file in one transaction, so an
-- unguarded second scan writes out_at = now() = the SAME value it wrote the
-- first time. "unchanged" is then true whether or not the guard exists. Moving
-- the stamp into the past makes the overwrite observable, which is the only way
-- this assertion can fail when the guard is missing.
update public.muster_attendance set out_at = now() - interval '40 minutes'
  where worker_id = 'e2000000-306c-306c-306c-e20000000306'
    and work_date = current_date and session = 'regular';

insert into _ts select 'regular_out', out_at from public.muster_attendance
  where worker_id = 'e2000000-306c-306c-306c-e20000000306'
    and work_date = current_date and session = 'regular';

-- ============================================================================
-- B. ① out_at — the second scan is REFUSED and the real departure survives.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select throws_ok(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e2000000-306c-306c-306c-e20000000306', 'manual') $$,
  'P0001',
  null,
  'a SECOND scan-out on the same session is refused');
reset role;

select is(
  (select out_at from public.muster_attendance
    where worker_id = 'e2000000-306c-306c-306c-e20000000306'
      and work_date = current_date and session = 'regular'),
  (select v from _ts where k = 'regular_out'),
  'out_at is byte-identical after the refusal — the real departure survived');

-- out_method, the FOURTH value the unguarded update rewrote. The second scan
-- above passed a DIFFERENT method on purpose ('manual' vs the original 'qr') —
-- an assertion that both are 'qr' would pass with or without the guard, which is
-- what the first draft of this file did with out_auto here (the unguarded body
-- writes out_auto = false on the second scan too, so it could not fail).
select is(
  (select out_method::text from public.muster_attendance
    where worker_id = 'e2000000-306c-306c-306c-e20000000306'
      and work_date = current_date and session = 'regular'),
  'qr',
  'out_method still records how they ACTUALLY left, not the refused re-scan');

-- ============================================================================
-- C. ② ot_hours — the money half. An OT re-scan would RE-PRICE the span.
--
--    in_at is pushed back two hours first, so the priced span is a real number
--    (0 would make "unchanged" trivially true and the assertion vacuous).
-- ============================================================================
update public.muster_attendance set in_at = now() - interval '2 hours'
  where worker_id = 'e3000000-306c-306c-306c-e30000000306'
    and work_date = current_date and session = 'ot';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select public.muster_scan_out((select id from _ids where k = 'team'),
  'e3000000-306c-306c-306c-e30000000306', 'qr', 'ot');
reset role;

select cmp_ok(
  (select ot_hours from public.muster_attendance
    where worker_id = 'e3000000-306c-306c-306c-e30000000306'
      and work_date = current_date and session = 'ot'),
  '>=',
  1.5::numeric,
  'the OT close priced a real span (so the unchanged-check below is not vacuous)');

insert into _ts select 'ot_in', in_at from public.muster_attendance
  where worker_id = 'e3000000-306c-306c-306c-e30000000306'
    and work_date = current_date and session = 'ot';

-- Push in_at back FURTHER: under the old code the re-scan reprices from
-- now() − in_at, so a successful second call would visibly INFLATE ot_hours.
-- If the guard is missing this makes the failure loud instead of borderline.
update public.muster_attendance set in_at = now() - interval '9 hours'
  where worker_id = 'e3000000-306c-306c-306c-e30000000306'
    and work_date = current_date and session = 'ot';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select throws_ok(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e3000000-306c-306c-306c-e30000000306', 'qr', 'ot') $$,
  'P0001',
  null,
  'a second scan-out on a CLOSED ot session is refused');
reset role;

select cmp_ok(
  (select ot_hours from public.muster_attendance
    where worker_id = 'e3000000-306c-306c-306c-e30000000306'
      and work_date = current_date and session = 'ot'),
  '<',
  9::numeric,
  'ot_hours did NOT inflate to the 9h span — the priced OT survived');

-- ============================================================================
-- D. ③ out_auto — an auto-closed day must not be laundered into a real one.
--
--    close_muster_day auto-outs REGULAR sessions with out_auto = true. Under
--    the old code a later scan set out_auto = false, so the row then claimed a
--    departure nobody recorded — on a screen the worker themselves now reads.
--    Written directly: muster_attendance carries no triggers, and calling
--    close_muster_day here would book wages and drag the money wall in.
-- ============================================================================
update public.muster_attendance
   set out_at = now() - interval '30 minutes', out_method = 'manual', out_auto = true
 where worker_id = 'e4000000-306c-306c-306c-e40000000306'
   and work_date = current_date and session = 'regular';

insert into _ts select 'auto_out', out_at from public.muster_attendance
  where worker_id = 'e4000000-306c-306c-306c-e40000000306'
    and work_date = current_date and session = 'regular';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select throws_ok(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e4000000-306c-306c-306c-e40000000306', 'qr') $$,
  'P0001',
  null,
  'a scan-out on an AUTO-closed row is refused');
reset role;

select ok(
  (select out_auto from public.muster_attendance
    where worker_id = 'e4000000-306c-306c-306c-e40000000306'
      and work_date = current_date and session = 'regular'),
  'out_auto stays TRUE — the ปิดอัตโนมัติ signal is not laundered away');

select is(
  (select out_at from public.muster_attendance
    where worker_id = 'e4000000-306c-306c-306c-e40000000306'
      and work_date = current_date and session = 'regular'),
  (select v from _ts where k = 'auto_out'),
  'and its out_at is untouched');

-- ============================================================================
-- E. The guard is ROW-scoped, not a blanket — a still-open worker closes fine
--    AFTER all the refusals above. Without this the whole file passes against
--    an RPC that simply stopped working.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select lives_ok(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e5000000-306c-306c-306c-e50000000306', 'qr') $$,
  'a DIFFERENT worker who is still open can still be checked out');
reset role;

select isnt(
  (select out_at from public.muster_attendance
    where worker_id = 'e5000000-306c-306c-306c-e50000000306'
      and work_date = current_date and session = 'regular'),
  null,
  'and that scan-out really landed');

-- ============================================================================
-- F. The refusal must not be swallowed by an EARLIER arm of scanErrorToThai.
--    That mapper matches on message substrings in order, and "no attendance"
--    already answers ยังไม่ได้เช็คชื่อ — the OPPOSITE claim. Pin the wording
--    the client keys on so a later reword cannot silently re-route the copy.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-306c-306c-306c-700000000306"}';
select throws_like(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e2000000-306c-306c-306c-e20000000306', 'qr') $$,
  '%already checked out%',
  'the message says already checked out (the substring the Thai copy keys on)');
-- Match the MESSAGE, not just the errcode: both refusals raise P0001, so an
-- errcode-only assertion proves nothing about WHICH arm fired — which is the
-- entire point of this case.
select throws_like(
  $$ select public.muster_scan_out((select id from _ids where k = 'team'),
       'e9999999-306c-306c-306c-e90000000306', 'qr') $$,
  '%no attendance%',
  'an unknown worker still reports the no-attendance refusal, not the new one');
reset role;

-- ============================================================================
-- G. FOR UPDATE — the guard would be a TOCTOU without it. Asserted on the
--    function SOURCE because two concurrent transactions cannot be driven from
--    one pgTAP session: this is the one property the behavioural tests above
--    structurally cannot reach.
--
--    ⚠️ COMMENTS STRIPPED FIRST. pg_get_functiondef returns the body INCLUDING
--    its comments, and this function's comments explain the `for update` and the
--    `out_at is not null` guard by name — so a bare ilike is satisfied by the
--    prose alone. Deleting the real clause and keeping the comment would leave
--    both assertions green and the TOCTOU wide open: documenting the hazard
--    would have stood in for fixing it. Anchored to the statement they belong to
--    as well, so a `for update` somewhere else in the body cannot answer for the
--    one on the attendance read.
-- ============================================================================
select ok(
  regexp_replace(pg_get_functiondef('public.muster_scan_out'::regproc), '--[^\n]*', '', 'g')
    ilike '%and session = p_session%for update%',
  'the attendance row is locked FOR UPDATE, so the guard cannot be raced');

select ok(
  regexp_replace(pg_get_functiondef('public.muster_scan_out'::regproc), '--[^\n]*', '', 'g')
    ilike '%v_att.out_at is not null%',
  'and the refusal keys on out_at, not on a proxy the caller controls');

select * from finish();
rollback;
