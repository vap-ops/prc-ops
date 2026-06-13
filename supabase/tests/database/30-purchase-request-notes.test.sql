-- Spec 48 / 73 — purchase_requests.notes posture + the editable-note RPC.
--
-- Spec 48: the note is write-once by GRANT posture — authenticated may
-- INSERT it but never UPDATE it directly (column-scope doctrine, ADR 0038),
-- and appsheet_writer never sees it (ADR 0034). Spec 73 keeps that grant
-- posture and adds set_purchase_request_notes (SECURITY DEFINER) as the
-- controlled edit path: the requester edits their own note, back-office
-- (pm/procurement/super) edits any.

begin;

select plan(13);

-- Fixtures: sa1 is the request's REQUESTER; pm is back-office; sa2 is a
-- different site_admin (not the requester, not back-office); visitor.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110030', 'sa1@prn-test.local',     '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220030', 'pm@prn-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330030', 'sa2@prn-test.local',     '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440030', 'visitor@prn-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '11111111-1111-1111-1111-111111110030';
update public.users set role = 'project_manager' where id = '22222222-2222-2222-2222-222222220030';
update public.users set role = 'site_admin'      where id = '33333333-3333-3333-3333-333333330030';
-- 4444…0030 keeps default 'visitor'.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc0030', 'PRC-TEST-PRN', 'PRN fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee0030',
   'cccccccc-cccc-cccc-cccc-cccccccc0030', 'WP-PRN-1', 'PRN fixture WP');

-- PR requested by sa1.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status, notes)
values
  ('a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee0030',
   'Cement', 10, 'bag', '11111111-1111-1111-1111-111111110030', 'requested', 'หมายเหตุเริ่มต้น');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Grant posture (spec 48 — unchanged by spec 73; the RPC is the edit path).
-- ============================================================================

select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'notes', 'INSERT'),
  true, 'authenticated can INSERT notes (requester sets it at creation)');
select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'notes', 'UPDATE'),
  false, 'authenticated still has NO direct UPDATE on notes (edit is via the RPC only)');
select is(
  has_column_privilege('appsheet_writer', 'public.purchase_requests', 'notes', 'UPDATE'),
  false, 'appsheet_writer has NO UPDATE on notes (ADR 0034 column freeze)');

-- B. Catalog.
select has_function('public', 'set_purchase_request_notes',
  'set_purchase_request_notes RPC exists');

-- ============================================================================
-- C. RPC role-sim.
-- ============================================================================

set local role authenticated;

-- C.1/C.2 the requester edits their OWN note.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110030"}';
select is(
  public.set_purchase_request_notes('a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030', 'แก้โดยผู้ขอ'),
  true, 'requester edits their own note');
select is(
  (select notes from public.purchase_requests
     where id = 'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030'),
  'แก้โดยผู้ขอ', 'the requester edit landed');

-- C.3/C.4 back-office (pm) edits a note on a request they did NOT raise.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220030"}';
select is(
  public.set_purchase_request_notes('a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030', 'แก้โดยฝ่ายจัดซื้อ'),
  true, 'back-office edits any request note');
select is(
  (select notes from public.purchase_requests
     where id = 'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030'),
  'แก้โดยฝ่ายจัดซื้อ', 'the back-office edit landed');

-- C.5 a different site_admin (not the requester, not back-office) is refused.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330030"}';
select throws_ok(
  $$ select public.set_purchase_request_notes(
       'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030', 'ไม่ควรได้') $$,
  '42501', null, 'a non-requester site_admin cannot edit the note');

-- C.6 visitor refused.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440030"}';
select throws_ok(
  $$ select public.set_purchase_request_notes(
       'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030', 'ไม่ควรได้') $$,
  '42501', null, 'visitor cannot edit the note');

-- C.7/C.8 the requester clears the note with a blank value → null.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110030"}';
select is(
  public.set_purchase_request_notes('a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030', '   '),
  true, 'a blank note is accepted (returns true)');
select is(
  (select notes from public.purchase_requests
     where id = 'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030'),
  null::text, 'a blank note clears the column to null');

-- C.9 the length CHECK rejects an over-long note (via the RPC, back-office).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220030"}';
select throws_ok(
  $$ select public.set_purchase_request_notes(
       'a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaa0030', repeat('x', 2001)) $$,
  '23514', null, 'notes longer than 2000 chars violate purchase_requests_notes_len');

reset role;

select * from finish();
rollback;
