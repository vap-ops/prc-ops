begin;
select plan(21);

-- ============================================================================
-- Spec 277 P1a — site-issue log (แจ้งปัญหา).
--
-- site_issues is a light, project-scoped problem record (type + optional note +
-- photos) reported from the SA home. report_site_issue / resolve_site_issue clone
-- record_site_purchase's shape: a null-safe role gate, then a membership gate
-- (can_see_project) placed AFTER the existence check so an unknown scope stays
-- P0001 and only a non-member gets 42501. add_site_issue_attachment clones
-- add_feedback_attachment (owner-only). site_issue_attachments is append-only.
-- Members read issues in their visible projects (can_see_project SELECT policy);
-- writes go only through the DEFINER RPCs.
-- Mirrors 289-record-site-purchase-scope (gate + seed) + 20260813000200 (attach).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('15151515-1515-1515-1515-000000000293', 'samember@p1a.local',   '{}'::jsonb),
  ('16161616-1616-1616-1616-000000000293', 'saoutsider@p1a.local', '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000293', 'pmoutsider@p1a.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000293', 'super@p1a.local',      '{}'::jsonb);
update public.users set role='site_admin',      full_name='ช่างสมาชิก'    where id='15151515-1515-1515-1515-000000000293';
update public.users set role='site_admin',      full_name='ช่างนอกโครงการ' where id='16161616-1616-1616-1616-000000000293';
update public.users set role='project_manager', full_name='พีเอ็มนอก'     where id='12121212-1212-1212-1212-000000000293';
update public.users set role='super_admin',     full_name='ซุปเปอร์'       where id='19191919-1919-1919-1919-000000000293';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000293', 'P1A-P', 'โครงการทดสอบ P1a'),
  ('bb000000-0000-0000-0000-000000000293', 'P1A-Q', 'โครงการอื่น P1a');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000000-0000-0000-0000-000000000293', 'aa000000-0000-0000-0000-000000000293',
   'WP-P', 'งานในโครงการ P', 'in_progress'),
  ('ff000000-0000-0000-0000-000000000293', 'bb000000-0000-0000-0000-000000000293',
   'WP-Q', 'งานในโครงการ Q', 'in_progress');

-- Only the MEMBER site_admin is enrolled in project P; the outsiders are neither
-- members nor project lead → can_see_project is false for them.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000293', '15151515-1515-1515-1515-000000000293',
   '19191919-1919-1919-1919-000000000293');

-- A seeded OPEN issue in project P, reported by the member SA, for the RLS,
-- attachment, append-only and resolve assertions (seeded directly as the txn
-- superuser; the app path is report_site_issue, exercised in section B).
insert into public.site_issues (id, project_id, issue_type, status, note, reported_by) values
  ('c1000000-0000-0000-0000-000000000293', 'aa000000-0000-0000-0000-000000000293',
   'equipment', 'open', 'เครื่องผสมปูนเสีย', '15151515-1515-1515-1515-000000000293');
insert into public.site_issue_attachments (id, site_issue_id, storage_path, uploaded_by) values
  ('d1000000-0000-0000-0000-000000000293', 'c1000000-0000-0000-0000-000000000293',
   'issue/c1000000-0000-0000-0000-000000000293/seed.jpg', '15151515-1515-1515-1515-000000000293');

-- Assertions run while role=authenticated → grant the runner's _tap_buf collector
-- (+ its sequence) to authenticated, else the first wrapped insert 42501-aborts the
-- whole file (pgtap-tapbuf-grant-role-switch).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Structure — anon lockdown + append-only (must hold for every role).
-- ============================================================================
select is(has_function_privilege('anon',
  'public.report_site_issue(uuid, uuid, site_issue_type, text)', 'EXECUTE'),
  false, 'anon cannot execute report_site_issue');
select is(has_function_privilege('anon',
  'public.add_site_issue_attachment(uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute add_site_issue_attachment');
select is(has_function_privilege('anon',
  'public.resolve_site_issue(uuid)', 'EXECUTE'),
  false, 'anon cannot execute resolve_site_issue');

-- site_issue_attachments is append-only (the attachment doctrine) — UPDATE/DELETE
-- raise P0001 for every role, including the txn superuser here.
select throws_ok(
  $$ update public.site_issue_attachments set storage_path='x'
       where id='d1000000-0000-0000-0000-000000000293' $$,
  'P0001', null, 'site_issue_attachments UPDATE blocked (append-only)');
select throws_ok(
  $$ delete from public.site_issue_attachments
       where id='d1000000-0000-0000-0000-000000000293' $$,
  'P0001', null, 'site_issue_attachments DELETE blocked (append-only)');

set local role authenticated;

-- ============================================================================
-- B. report_site_issue — role gate + membership scope (gate-after-existence).
-- ============================================================================
-- B.1 (guard) a MEMBER site_admin reports an issue.
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000293"}';
select lives_ok(
  $$ select public.report_site_issue(
       'aa000000-0000-0000-0000-000000000293', null, 'weather', 'ฝนตกหนัก งานหยุด') $$,
  'member site_admin reports a site issue');

-- B.2 (scope) a NON-member site_admin is denied 42501.
set local "request.jwt.claims" = '{"sub": "16161616-1616-1616-1616-000000000293"}';
select throws_ok(
  $$ select public.report_site_issue(
       'aa000000-0000-0000-0000-000000000293', null, 'weather', null) $$,
  '42501', null, 'non-member site_admin is denied (42501)');

-- B.2b (placement) an UNKNOWN project fails P0001 'not found', NOT the membership
--      42501 — the existence check precedes the membership gate. Still the non-member SA.
select throws_ok(
  $$ select public.report_site_issue(
       'a0000000-0000-0000-0000-0000000000ff', null, 'weather', null) $$,
  'P0001', null, 'unknown project rejected P0001 (existence precedes membership gate)');

-- B.3 the gate scopes the PM tier too: a non-member PM denied.
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000293"}';
select throws_ok(
  $$ select public.report_site_issue(
       'aa000000-0000-0000-0000-000000000293', null, 'safety', null) $$,
  '42501', null, 'non-member project_manager is denied (42501)');

-- B.4 (guard) super_admin bypasses membership (privileged, unconditional).
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000293"}';
select lives_ok(
  $$ select public.report_site_issue(
       'aa000000-0000-0000-0000-000000000293', null, 'access', null) $$,
  'super_admin (non-member) still reports — privileged bypass preserved');

-- B.5 (WP scope) an optional WP must belong to the named project. A member SA
--     naming a WP from ANOTHER project fails P0001 — not a member-scope leak.
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000293"}';
select throws_ok(
  $$ select public.report_site_issue(
       'aa000000-0000-0000-0000-000000000293',
       'ff000000-0000-0000-0000-000000000293', 'other', null) $$,
  'P0001', null, 'a WP from another project is rejected P0001 (WP must match project)');

-- B.6 (defaults) the optional params (p_work_package_id / p_note) carry DEFAULT NULL
--     so a project-level report can omit them (still the member SA).
select lives_ok(
  $$ select public.report_site_issue(
       p_project_id => 'aa000000-0000-0000-0000-000000000293',
       p_issue_type => 'other') $$,
  'a project-level report omits the optional WP + note (DEFAULT NULL params)');

-- ============================================================================
-- C. add_site_issue_attachment — owner-only (mirrors add_feedback_attachment).
-- ============================================================================
-- C.1 the OWNER (reporter) attaches to their own issue.
select lives_ok(
  $$ select public.add_site_issue_attachment(
       'c1000000-0000-0000-0000-000000000293',
       'issue/c1000000-0000-0000-0000-000000000293/photo1.jpg') $$,
  'owner attaches a photo to their own issue');

-- C.2 a NON-owner (super_admin, not the reporter) is denied 42501.
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000293"}';
select throws_ok(
  $$ select public.add_site_issue_attachment(
       'c1000000-0000-0000-0000-000000000293',
       'issue/c1000000-0000-0000-0000-000000000293/intruder.jpg') $$,
  '42501', null, 'a non-owner cannot attach to someone else''s issue (42501)');

-- C.3 (F1 path-guard) even the OWNER cannot record a path outside this issue's own
--     folder — the stored path must sit under issue/<thisIssueId>/ (mirrors the
--     owner-bound storage upload policy). Back to the owner (sa_member).
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000293"}';
select throws_ok(
  $$ select public.add_site_issue_attachment(
       'c1000000-0000-0000-0000-000000000293',
       'issue/ffffffff-ffff-ffff-ffff-ffffffffffff/elsewhere.jpg') $$,
  '22023', null, 'owner cannot record a path outside the issue folder (F1 guard)');

-- ============================================================================
-- D. RLS read scope + resolve_site_issue.
-- ============================================================================
-- D.0 a non-member cannot resolve (42501, gate-after-existence).
set local "request.jwt.claims" = '{"sub": "16161616-1616-1616-1616-000000000293"}';
select throws_ok(
  $$ select public.resolve_site_issue('c1000000-0000-0000-0000-000000000293') $$,
  '42501', null, 'non-member cannot resolve an issue (42501)');

-- D.1 RLS: a non-member sees NONE of project P's issues.
select is(
  (select count(*)::int from public.site_issues
     where id='c1000000-0000-0000-0000-000000000293'),
  0, 'non-member does not see the project issue (RLS)');

-- D.2 RLS: the member sees it.
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000293"}';
select is(
  (select count(*)::int from public.site_issues
     where id='c1000000-0000-0000-0000-000000000293'),
  1, 'member sees the project issue (RLS)');

-- D.3 the member (reporter) resolves it, flipping the status.
select lives_ok(
  $$ select public.resolve_site_issue('c1000000-0000-0000-0000-000000000293') $$,
  'member resolves the issue');
select is(
  (select status::text from public.site_issues
     where id='c1000000-0000-0000-0000-000000000293'),
  'resolved', 'resolve_site_issue flips status to resolved');

reset role;

-- D.4 (residue) every report_site_issue by the NON-member SA was denied before the
--     insert, so they authored zero issue rows (read as the txn superuser).
select is(
  (select count(*)::int from public.site_issues
     where reported_by = '16161616-1616-1616-1616-000000000293'),
  0, 'denied non-member wrote no issue row (residue 0)');

select * from finish();
rollback;
