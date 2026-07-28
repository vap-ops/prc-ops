begin;
select plan(17);

-- ============================================================================
-- Spec 371 U2 — public.work_package_review_queue, the ONE definition of
-- "whose move is a pending work package".
--
-- The ภาพรวม hero and the nav badge both counted bare status='pending_approval'
-- and reported a blended 70 when only 52 were the PM's move (operator
-- 2026-07-28: "Amount 70 items is misleading, how about separating them?").
-- This view is the predicate both surfaces now read, so the number they show
-- and the list /review renders cannot drift.
--
-- Pins: the view exists and is security_invoker (RLS of the CALLER applies —
-- the counts are deliberately per-viewer); the three zones; that an answered
-- bounce returns to actionable while an un-cured one does not; that a
-- non-needs_revision decision stays actionable rather than vanishing into the
-- collapsed zone; bounced_at/revision_reason passthrough; and that a caller who
-- cannot see the project sees none of its rows.
--
-- ⚠️ Every assert is scoped to fixture ids — the view reads LIVE prod rows, so
-- a global count would be a data-dependent red (doctrine: never assert a global
-- count on an operator-writable table).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000371', 'pd@rvq371.local', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000371', 'sa@rvq371.local', '{}'::jsonb),
  ('30000000-0000-4000-8000-000000000371', 'out@rvq371.local', '{}'::jsonb);
update public.users set role = 'project_director' where id = '10000000-0000-4000-8000-000000000371';
update public.users set role = 'site_admin'       where id = '20000000-0000-4000-8000-000000000371';
-- ⚠️ The see-nothing control MUST be a membership-scoped role. `can_see_project`
-- (read live) returns true UNCONDITIONALLY for super_admin / project_coordinator /
-- project_director / procurement_manager, and only consults project_members for
-- project_manager / site_admin / site_owner / auditor. A project_director here
-- would see every row and the assert would look like a view bug — it is not.
-- Matches the live probe: project_manager "Moo", not a member, sees 0 of the 70.
update public.users set role = 'project_manager'  where id = '30000000-0000-4000-8000-000000000371';

insert into public.projects (id, code, name) values
  ('c1000000-0000-4000-8000-000000000371', 'TAP-RVQ-1', 'Review view project');
insert into public.project_members (project_id, user_id, added_by) values
  ('c1000000-0000-4000-8000-000000000371', '10000000-0000-4000-8000-000000000371',
   '10000000-0000-4000-8000-000000000371'),
  ('c1000000-0000-4000-8000-000000000371', '20000000-0000-4000-8000-000000000371',
   '10000000-0000-4000-8000-000000000371');
-- 30…371 is deliberately NOT a member: the see-nothing control.

-- Four pending WPs, one per case, plus a non-pending control.
insert into public.work_packages (id, project_id, code, name, status, updated_at) values
  ('e1000000-0000-4000-8000-000000000371', 'c1000000-0000-4000-8000-000000000371',
   'WP-RVQ-1', 'never reviewed',        'pending_approval', '2001-01-10 09:00:00+00'),
  ('e2000000-0000-4000-8000-000000000371', 'c1000000-0000-4000-8000-000000000371',
   'WP-RVQ-2', 'bounced, not answered', 'pending_approval', '2001-01-11 09:00:00+00'),
  ('e3000000-0000-4000-8000-000000000371', 'c1000000-0000-4000-8000-000000000371',
   'WP-RVQ-3', 'bounced, answered',     'pending_approval', '2001-01-12 09:00:00+00'),
  ('e4000000-0000-4000-8000-000000000371', 'c1000000-0000-4000-8000-000000000371',
   'WP-RVQ-4', 'decided, still queued', 'pending_approval', '2001-01-13 09:00:00+00'),
  ('e5000000-0000-4000-8000-000000000371', 'c1000000-0000-4000-8000-000000000371',
   'WP-RVQ-5', 'not in the queue',      'in_progress',      '2001-01-14 09:00:00+00');

-- WP-2 bounced and NOT answered. WP-3 bounced twice: the OLDER decision is
-- answered, the NEWER one is what counts — it is answered too (see audit below),
-- so WP-3 is ready_again. WP-4 carries an `approved` decision (which should never
-- sit at pending_approval, but if one does it must stay visible + actionable).
insert into public.approvals (id, work_package_id, decision, comment, revision_reason, decided_by, decided_at) values
  ('a2000000-0000-4000-8000-000000000371', 'e2000000-0000-4000-8000-000000000371',
   'needs_revision', 'reshoot please', 'mismatch',
   '10000000-0000-4000-8000-000000000371', '2001-02-01 09:00:00+00'),
  ('a3000000-0000-4000-8000-000000000371', 'e3000000-0000-4000-8000-000000000371',
   'needs_revision', 'older ask', 'incomplete',
   '10000000-0000-4000-8000-000000000371', '2001-02-01 09:00:00+00'),
  ('a3100000-0000-4000-8000-000000000371', 'e3000000-0000-4000-8000-000000000371',
   'needs_revision', 'newer ask', null,
   '10000000-0000-4000-8000-000000000371', '2001-02-05 09:00:00+00'),
  ('a4000000-0000-4000-8000-000000000371', 'e4000000-0000-4000-8000-000000000371',
   'approved', 'anomaly', null,
   '10000000-0000-4000-8000-000000000371', '2001-02-02 09:00:00+00');

-- The resubmit answers WP-3's NEWEST decision only.
insert into public.audit_log (actor_id, action, target_table, target_id, payload) values
  ('20000000-0000-4000-8000-000000000371', 'other', 'work_packages',
   'e3000000-0000-4000-8000-000000000371',
   jsonb_build_object('event', 'wp_evidence_resubmitted',
                      'answers_decision_id', 'a3100000-0000-4000-8000-000000000371'));

-- ---------------------------------------------------------------- structure
select has_view('public', 'work_package_review_queue', 'the review-queue view exists');

select is(
  (select count(*)::int from pg_options_to_table(
     (select reloptions from pg_class where oid = 'public.work_package_review_queue'::regclass))
   where option_name = 'security_invoker' and option_value = 'true'),
  1,
  'security_invoker = true — the caller''s RLS decides, so counts stay per-viewer'
);

-- The house hardening: no anon/PUBLIC reach. has_table_privilege resolves PUBLIC
-- through role inheritance, which information_schema.role_table_grants does NOT
-- (it has no PUBLIC arm) — the bespoke catalog query cannot fail on the real hazard.
select ok(
  not has_table_privilege('anon', 'public.work_package_review_queue', 'SELECT'),
  'anon cannot read the view'
);

-- ------------------------------------------------------------ classification
-- The runner rewrites each assertion into `insert into _tap_buf(...)`, so once
-- we drop to `authenticated` those inserts need their own grants (memory
-- `pgtap-tapbuf-grant-role-switch` — otherwise every later assert 42501s).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','10000000-0000-4000-8000-000000000371','role','authenticated')::text, true);

select is((select zone from public.work_package_review_queue
           where id = 'e1000000-0000-4000-8000-000000000371'),
          'first_review', 'never reviewed → first_review');

select is((select zone from public.work_package_review_queue
           where id = 'e2000000-0000-4000-8000-000000000371'),
          'awaiting_site', 'un-cured bounce → awaiting_site (NOT the PM''s move)');

select is((select zone from public.work_package_review_queue
           where id = 'e3000000-0000-4000-8000-000000000371'),
          'ready_again', 'answered bounce → ready_again (back to the PM)');

select is((select zone from public.work_package_review_queue
           where id = 'e4000000-0000-4000-8000-000000000371'),
          'first_review',
          'a decided-but-queued WP stays actionable — never hidden in the collapsed zone');

select is((select count(*)::int from public.work_package_review_queue
           where id = 'e5000000-0000-4000-8000-000000000371'),
          0, 'a WP that is not pending_approval is not in the queue at all');

-- The point of the unit: the actionable count EXCLUDES the un-cured bounce.
select is((select count(*)::int from public.work_package_review_queue
           where project_id = 'c1000000-0000-4000-8000-000000000371'
             and zone <> 'awaiting_site'),
          3, 'actionable = 3 of the 4 fixture rows');

select is((select count(*)::int from public.work_package_review_queue
           where project_id = 'c1000000-0000-4000-8000-000000000371'
             and zone = 'awaiting_site'),
          1, 'awaiting_site = the 1 un-cured bounce, counted separately');

-- -------------------------------------------------------------- passthrough
select is((select bounced_at from public.work_package_review_queue
           where id = 'e2000000-0000-4000-8000-000000000371'),
          '2001-02-01 09:00:00+00'::timestamptz,
          'bounced_at is the DECISION time, not queue entry — the chase clock');

select is((select revision_reason::text from public.work_package_review_queue
           where id = 'e2000000-0000-4000-8000-000000000371'),
          'mismatch', 'revision_reason rides through for the chase chip');

select is((select bounced_at from public.work_package_review_queue
           where id = 'e1000000-0000-4000-8000-000000000371'),
          null, 'a never-reviewed row has no bounce stamp');

-- WP-3's LATEST decision carries a null reason; the older one says 'incomplete'.
-- Reading the older would be the classic "latest per group" bug.
select is((select revision_reason::text from public.work_package_review_queue
           where id = 'e3000000-0000-4000-8000-000000000371'),
          null, 'the LATEST decision wins, not the first one found');

-- -------------------------------------------------------------- RLS scoping
-- Positive control paired with the negative below: without it, "sees 0 rows"
-- is equally consistent with the view being broken for everyone.
-- Named for what it actually proves: this caller is a project_director, for whom
-- can_see_project is true UNCONDITIONALLY. It is the positive half of the pair,
-- not evidence about membership.
select is((select count(*)::int from public.work_package_review_queue
           where project_id = 'c1000000-0000-4000-8000-000000000371'),
          4, 'a caller with project visibility sees all four queued rows (positive control)');

-- The migration comment claims site_admin classifies correctly because the
-- SECOND audit_log policy ('audit_log select wp rework events') admits them to
-- wp_evidence_resubmitted. Nothing pinned that: narrowing that policy would
-- silently flip ready_again → awaiting_site for every SA with pgTAP still green.
select set_config('request.jwt.claims',
  json_build_object('sub','20000000-0000-4000-8000-000000000371','role','authenticated')::text, true);

select is((select zone from public.work_package_review_queue
           where id = 'e3000000-0000-4000-8000-000000000371'),
          'ready_again',
          'site_admin resolves the cured bounce too — the rework-events audit policy holds');

select set_config('request.jwt.claims',
  json_build_object('sub','30000000-0000-4000-8000-000000000371','role','authenticated')::text, true);

select is((select count(*)::int from public.work_package_review_queue
           where project_id = 'c1000000-0000-4000-8000-000000000371'),
          0, 'a membership-scoped role who is NOT a member sees none of its rows');

select * from finish();
rollback;
