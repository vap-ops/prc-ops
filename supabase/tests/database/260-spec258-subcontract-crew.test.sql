begin;
select plan(26);

-- ============================================================================
-- Spec 258 U1 — subcontract crew register (ลูกทีมผู้รับเหมาช่วง): 2 tables
-- (subcontract_crew_members / subcontract_crew_attachments), 1 enum
-- (crew_doc_purpose), 3 RPCs (add_crew_member/update_crew_member/
-- add_crew_document), storage bucket. Deliberate RLS INVERSION of the spec-97
-- pin: site_admin CAN read here (project-scoped via can_see_project) — the
-- point is site-gate verification, unlike contact_attachments where site_admin
-- is excluded. Writes PM_ROLES only. No money on crew rows.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111258', 'pm@sc258.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222258', 'sa_own@sc258.local', '{}'::jsonb),
  ('a3333333-3333-3333-3333-333333333258', 'sa_other@sc258.local', '{}'::jsonb),
  ('a4444444-4444-4444-4444-444444444258', 'client@sc258.local', '{}'::jsonb);
update public.users set role='project_manager' where id='a1111111-1111-1111-1111-111111111258';
update public.users set role='site_admin'      where id='a2222222-2222-2222-2222-222222222258';
update public.users set role='site_admin'      where id='a3333333-3333-3333-3333-333333333258';
update public.users set role='client'          where id='a4444444-4444-4444-4444-444444444258';

-- PM (a1111111) is project A's lead — matches realistic can_see_project
-- semantics (a project_manager sees only projects they lead or are a member
-- of; the RLS reads below are the real test of that, not a bypass).
insert into public.projects (id, code, name, project_lead_id) values
  ('aa000000-0000-0000-0000-000000000258', 'SC258A', 'โครงการ 258A', 'a1111111-1111-1111-1111-111111111258'),
  ('ab000000-0000-0000-0000-000000000258', 'SC258B', 'โครงการ 258B (SA has no access)', null);

-- sa_own is a member of project A only; sa_other has no membership anywhere.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000258', 'a2222222-2222-2222-2222-222222222258',
   'a1111111-1111-1111-1111-111111111258');

insert into public.contractors (id, name, created_by) values
  ('c1000000-0000-0000-0000-000000000258', 'ผู้รับเหมาช่วง 258', 'a1111111-1111-1111-1111-111111111258');

create temporary table _fix (k text primary key, v uuid) on commit drop;
grant select on _fix to authenticated;
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Fixture deal (PM, direct insert as owner — subcontracts RPC tested in 258-spec251).
insert into public.subcontracts (id, contractor_id, project_id, title, agreed_amount, created_by)
values ('d1000000-0000-0000-0000-000000000258', 'c1000000-0000-0000-0000-000000000258',
        'aa000000-0000-0000-0000-000000000258', 'งานติดตั้ง 258', 300000,
        'a1111111-1111-1111-1111-111111111258');

-- 1. add_crew_member — PM registers a crew member under the deal.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select lives_ok(
  $$ select public.add_crew_member(
       'd1000000-0000-0000-0000-000000000258', 'สมชาย ใจดี', '1103700123456',
       'ไทย', null, null, '0812345678') $$,
  'PM registers a crew member');
reset role;
insert into _fix values ('m1',
  (select id from public.subcontract_crew_members where name = 'สมชาย ใจดี'));

-- 2. site_admin cannot write (role gate).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222258"}';
select throws_ok(
  $$ select public.add_crew_member(
       'd1000000-0000-0000-0000-000000000258', 'x', null, null, null, null, null) $$,
  '42501', null, 'site_admin cannot add a crew member (read yes, write no)');
reset role;

-- 3. unbound caller fails closed.
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.add_crew_member(
       'd1000000-0000-0000-0000-000000000258', 'x', null, null, null, null, null) $$,
  '42501', null, 'unbound caller fails closed (42501)');
reset role;

-- 4. A migrant crew member with a work permit.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select lives_ok(
  $$ select public.add_crew_member(
       'd1000000-0000-0000-0000-000000000258', 'Aung Min', null,
       'เมียนมา', 'WP-998877', date '2026-08-01', null) $$,
  'PM registers a migrant crew member with a work permit');
reset role;
insert into _fix values ('m2',
  (select id from public.subcontract_crew_members where name = 'Aung Min'));

-- 5-6. update_crew_member — coalesce semantics (name preserved, phone set).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select lives_ok(
  $$ select public.update_crew_member(
       (select v from _fix where k = 'm1'), null, null, null, null, null,
       '0899999999', null) $$,
  'PM updates crew member phone (coalesce)');
reset role;
select is(
  (select name from public.subcontract_crew_members where id = (select v from _fix where k = 'm1')),
  'สมชาย ใจดี', 'name preserved (coalesce semantics — omitted field untouched)');
select is(
  (select phone from public.subcontract_crew_members where id = (select v from _fix where k = 'm1')),
  '0899999999', 'phone updated');

-- 7. active=false (left the crew) — no delete ever.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select lives_ok(
  $$ select public.update_crew_member(
       (select v from _fix where k = 'm1'), null, null, null, null, null, null, false) $$,
  'PM marks a crew member inactive (left the crew)');
reset role;
select is(
  (select active from public.subcontract_crew_members where id = (select v from _fix where k = 'm1')),
  false, 'active flipped to false; row still exists (no delete)');

-- 8. add_crew_document — append-only doc scan.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select lives_ok(
  $$ select public.add_crew_document(
       (select v from _fix where k = 'm2'), 'work_permit', 'work_permit/m2/doc1.jpg') $$,
  'PM adds a work-permit scan for the migrant crew member');
reset role;
insert into _fix values ('doc1',
  (select id from public.subcontract_crew_attachments where crew_member_id = (select v from _fix where k = 'm2')));

-- 9. Append-only: even a superuser UPDATE is blocked.
select throws_ok(
  $$ update public.subcontract_crew_attachments set storage_path = 'x'
      where id = (select v from _fix where k = 'doc1') $$,
  'P0001', null, 'subcontract_crew_attachments rows are append-only (update blocked)');

-- 10-11. READ — site_admin who IS a member of the deal's project CAN read
-- both tables (the deliberate spec-97 inversion).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222258"}';
select is(
  (select count(*)::int from public.subcontract_crew_members
    where subcontract_id = 'd1000000-0000-0000-0000-000000000258'),
  2, 'site_admin (project member) reads the crew register (2 members)');
select is(
  (select count(*)::int from public.subcontract_crew_attachments
    where crew_member_id = (select v from _fix where k = 'm2')),
  1, 'site_admin (project member) reads the crew attachments');
reset role;

-- 12-13. READ — site_admin with NO membership on this project sees nothing
-- (project-scoped via can_see_project, the same-axis join).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333258"}';
select is(
  (select count(*)::int from public.subcontract_crew_members
    where subcontract_id = 'd1000000-0000-0000-0000-000000000258'),
  0, 'site_admin with no project access reads zero crew members (project-scoped)');
select is(
  (select count(*)::int from public.subcontract_crew_attachments
    where crew_member_id = (select v from _fix where k = 'm2')),
  0, 'site_admin with no project access reads zero attachments (project-scoped)');
reset role;

-- 14-15. client role: no access at all (crew PII is not client-visible).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a4444444-4444-4444-4444-444444444258"}';
select is(
  (select count(*)::int from public.subcontract_crew_members
    where subcontract_id = 'd1000000-0000-0000-0000-000000000258'),
  0, 'client role reads zero crew members');
select throws_ok(
  $$ select public.add_crew_member(
       'd1000000-0000-0000-0000-000000000258', 'x', null, null, null, null, null) $$,
  '42501', null, 'client role cannot add a crew member');
reset role;

-- 16. site_admin can still read even though it can never write (RPC gate,
-- already proven at #2 — this re-confirms read survives independent of write).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222258"}';
select ok(
  (select count(*)::int from public.subcontract_crew_members
    where subcontract_id = 'd1000000-0000-0000-0000-000000000258') > 0,
  'site_admin retains read access (write-denied at #2 is independent of read)');
reset role;

-- 17. update_crew_member: unknown crew member is rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select throws_ok(
  $$ select public.update_crew_member(
       '00000000-0000-0000-0000-000000000000', 'x', null, null, null, null, null, null) $$,
  'P0001', null, 'update_crew_member rejects an unknown crew member');
reset role;

-- 18. add_crew_member: unknown subcontract is rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select throws_ok(
  $$ select public.add_crew_member(
       '00000000-0000-0000-0000-000000000000', 'x', null, null, null, null, null) $$,
  'P0001', null, 'add_crew_member rejects an unknown subcontract');
reset role;

-- 19. add_crew_member: blank name is rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select throws_ok(
  $$ select public.add_crew_member(
       'd1000000-0000-0000-0000-000000000258', '', null, null, null, null, null) $$,
  'P0001', null, 'add_crew_member rejects a blank name');
reset role;

-- 20. add_crew_document: site_admin cannot write.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222258"}';
select throws_ok(
  $$ select public.add_crew_document(
       (select v from _fix where k = 'm2'), 'id_card', 'id_card/m2/x.jpg') $$,
  '42501', null, 'site_admin cannot add a crew document');
reset role;

-- 21. Storage bucket exists, private, image-only.
select is(
  (select public from storage.buckets where id = 'subcontract-crew-docs'),
  false, 'subcontract-crew-docs bucket is private');

-- 22. Storage upload policy: PM-only, path-shape bound.
select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'subcontract crew doc uploads by pm'
  ),
  'storage upload policy exists for subcontract crew docs');

-- 23. Audit trail for the crew-member add.
select ok(
  exists (select 1 from public.audit_log
    where action = 'subcontract_crew_member_add' and target_table = 'subcontract_crew_members'),
  'subcontract_crew_member_add audit row exists');

-- 24. Zero authenticated grant would be WRONG here (this table is meant to be
-- readable, unlike money tables) — confirm PM can read too (not just RPC-write).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111258"}';
select ok(
  (select count(*)::int from public.subcontract_crew_members
    where subcontract_id = 'd1000000-0000-0000-0000-000000000258') = 2,
  'PM reads the crew register directly (real RLS policy, not zero-grant money posture)');
reset role;

select * from finish();
rollback;
