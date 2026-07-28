begin;
select plan(14);

-- ============================================================================
-- Spec 372 U3 — "งานยังไม่เสร็จ" sends the work package BACK, not nowhere.
--
-- Before: every needs_revision decision left the WP at pending_approval. That is
-- right for the two PHOTO causes (the work is done, the evidence is not), but
-- wrong for `premature`: the work genuinely is not finished, so the review queue
-- was holding items nobody could action — the same complaint that drove spec 371.
--
-- Routing it through `rework` was considered and REJECTED: canSubmitForApproval
-- demands current-round after_fix once a WP is `rework`, so an SA who merely
-- FINISHED the work would be ordered to file completion photos as after-FIX for a
-- repair that never happened. `in_progress` keeps `after` as the evidence.
--
-- Body-only change: signature, DEFINER, grants and every other arm are untouched,
-- and this file pins that the other arms did not move.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110372', 'super@s372.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330372', 'pm@s372.local',    '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-111111110372';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333330372';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10372-0372-0372-0372-a1a1a1a10372', 'PRC-372-P1', 'โครงการทดสอบ 372',
   '33333333-3333-3333-3333-333333330372');

-- One WP per cause, all starting at pending_approval so the ONLY status write on
-- each is the one decide_work_package makes.
insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c1c10372-0372-0372-0372-c1c1c1c10372', 'a1a10372-0372-0372-0372-a1a1a1a10372',
   'W72-01', 'งานยังไม่เสร็จ',   'pending_approval', 0),
  ('c2c20372-0372-0372-0372-c2c2c2c20372', 'a1a10372-0372-0372-0372-a1a1a1a10372',
   'W72-02', 'รูปไม่ครบ',        'pending_approval', 0),
  ('c3c30372-0372-0372-0372-c3c3c3c30372', 'a1a10372-0372-0372-0372-a1a1a1a10372',
   'W72-03', 'รูปไม่ตรงกับงาน',  'pending_approval', 0),
  ('c4c40372-0372-0372-0372-c4c4c4c40372', 'a1a10372-0372-0372-0372-a1a1a1a10372',
   'W72-04', 'งานต้องแก้ไข',     'pending_approval', 0),
  ('c5c50372-0372-0372-0372-c5c5c5c50372', 'a1a10372-0372-0372-0372-a1a1a1a10372',
   'W72-05', 'งานอนุมัติ',       'pending_approval', 0);

-- The runner rewrites each assertion into `insert into _tap_buf(line) select …`,
-- so a test that switches role needs the buffer grants or every assertion 42501s
-- (memory: pgtap-tapbuf-grant-role-switch).
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330372"}';

-- ── The change itself ───────────────────────────────────────────────────────
select is(
  public.decide_work_package('c1c10372-0372-0372-0372-c1c1c1c10372', 'needs_revision',
                             'งานยังไม่จบ ต้องรอให้หล่อครบ', 'premature'),
  'in_progress',
  'premature returns the WP to in_progress');

select is(
  (select status::text from public.work_packages where id = 'c1c10372-0372-0372-0372-c1c1c1c10372'),
  'in_progress',
  'premature: the row really moved, not just the return value');

-- The round must NOT advance: nothing was defective, so this is not a rework
-- cycle and after_fix must not become the WP's completion evidence.
select is(
  (select rework_round from public.work_packages where id = 'c1c10372-0372-0372-0372-c1c1c1c10372'),
  0::smallint,
  'premature does NOT open a rework round');

-- The decision is still recorded as what it is — the route changed, not the record.
select is(
  (select decision::text from public.approvals
    where work_package_id = 'c1c10372-0372-0372-0372-c1c1c1c10372'),
  'needs_revision',
  'premature still records a needs_revision decision');

select is(
  (select revision_reason::text from public.approvals
    where work_package_id = 'c1c10372-0372-0372-0372-c1c1c1c10372'),
  'premature',
  'premature still records its reason');

select is(
  (select comment from public.approvals
    where work_package_id = 'c1c10372-0372-0372-0372-c1c1c1c10372'),
  'งานยังไม่จบ ต้องรอให้หล่อครบ',
  'the PM comment survives the new route — it is why the WP came back');

-- ── The other arms must NOT have moved ──────────────────────────────────────
select is(
  public.decide_work_package('c2c20372-0372-0372-0372-c2c2c2c20372', 'needs_revision',
                             null, 'incomplete'),
  'pending_approval',
  'incomplete still leaves the WP in the review queue');

select is(
  public.decide_work_package('c3c30372-0372-0372-0372-c3c3c3c30372', 'needs_revision',
                             null, 'mismatch'),
  'pending_approval',
  'mismatch still leaves the WP in the review queue');

select is(
  public.decide_work_package('c4c40372-0372-0372-0372-c4c4c4c40372', 'rejected',
                             'ผนังเอียง', null),
  'rework',
  'rejected still opens a rework cycle');

select is(
  (select rework_round from public.work_packages where id = 'c4c40372-0372-0372-0372-c4c4c4c40372'),
  1::smallint,
  'rejected still advances the round');

select is(
  public.decide_work_package('c5c50372-0372-0372-0372-c5c5c5c50372', 'approved', null, null),
  'complete',
  'approved still completes the WP');

-- ── The guards the RPC already enforced must still fire ─────────────────────
-- Positive control for the two below: without these the "refuses" assertions
-- could pass because the whole call is broken rather than because the guard bites.
select throws_ok(
  $$ select public.decide_work_package('c1c10372-0372-0372-0372-c1c1c1c10372',
                                       'needs_revision', null, 'premature') $$,
  '22023', 'decide_work_package: work package is not pending approval',
  'a WP already sent back cannot be decided again');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110372"}';
insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c6c60372-0372-0372-0372-c6c6c6c60372', 'a1a10372-0372-0372-0372-a1a1a1a10372',
   'W72-06', 'งานตรวจกติกา', 'pending_approval', 0);

select throws_ok(
  $$ select public.decide_work_package('c6c60372-0372-0372-0372-c6c6c6c60372',
                                       'needs_revision', null, null) $$,
  '22023', 'decide_work_package: revision reason required',
  'needs_revision still requires a reason');

select throws_ok(
  $$ select public.decide_work_package('c6c60372-0372-0372-0372-c6c6c6c60372',
                                       'approved', null, 'premature') $$,
  '22023', 'decide_work_package: revision reason only for needs_revision',
  'a reason is still refused on any other decision');

select * from finish();
rollback;
