-- Spec 380 U1 — purchase document typing + accounting-only waivers.
-- doc_type on BOTH attachment tables (nullable; legacy rows stay untyped =
-- covered-loose per §2 decision ②), purchase_doc_waivers keyed one-per-PR,
-- writes DEFINER-only (waive/unwaive, accounting + super_admin — decision ③).
-- Positive controls included: "refuses" alone is equally consistent with a
-- broken RPC (doctrine: absence asserts need a positive control).

begin;
select plan(27);

-- 1–4 · the two enums, values pinned exactly (order matters — UI sorts by it)
select has_type('public', 'purchase_doc_type', 'purchase_doc_type enum exists');
select results_eq(
  $$select unnest(enum_range(null::public.purchase_doc_type))::text$$,
  array['tax_invoice_full','receipt_cash_bill','payment_voucher','cert_in_lieu',
        'delivery_note','transfer_slip','other'],
  'purchase_doc_type values pinned');
select has_type('public', 'purchase_doc_waiver_reason', 'waiver reason enum exists');
select results_eq(
  $$select unnest(enum_range(null::public.purchase_doc_waiver_reason))::text$$,
  array['vendor_refused','docs_unobtainable','other'],
  'waiver reason values pinned');

-- 5–7 · doc_type columns on both attachment tables
select has_column('public', 'purchase_request_attachments', 'doc_type', 'PR attachments gain doc_type');
select col_type_is('public', 'purchase_request_attachments', 'doc_type', 'purchase_doc_type',
  'PR doc_type is the enum');
select has_column('public', 'purchase_order_attachments', 'doc_type', 'PO attachments gain doc_type');
select col_type_is('public', 'purchase_order_attachments', 'doc_type', 'purchase_doc_type',
  'PO doc_type is the enum');
select has_column('public', 'purchase_request_attachments_current', 'doc_type',
  'the _current view carries doc_type (readers never fall to the base table)');

-- 8–11 · waiver table shape + sealed-but-readable RLS
select has_table('public', 'purchase_doc_waivers', 'waiver table exists');
select col_is_unique('public', 'purchase_doc_waivers', 'purchase_request_id',
  'one waiver per purchase request');
select ok((select relrowsecurity from pg_class where oid = 'public.purchase_doc_waivers'::regclass),
  'RLS enabled on waivers');
select results_eq(
  $$select array_agg(polcmd::text order by polcmd) from pg_policy
     where polrelid = 'public.purchase_doc_waivers'::regclass$$,
  $$values (array['r'])$$,
  'exactly one policy and it is SELECT — writes are DEFINER-only');

-- fixture principals + a delivered store-first (wp-null) PR
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1','doccheck-acct@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000e2','doccheck-proc@t.local','{}'::jsonb);
update public.users set role='accounting'  where id='00000000-0000-0000-0000-0000000000e1';
update public.users set role='procurement' where id='00000000-0000-0000-0000-0000000000e2';
insert into public.projects (id, code, name) values
  ('00000000-0000-0000-0000-0000000000e4', 'PRC-TEST-380', 'doc-chase fixture project');
insert into public.purchase_requests (id, project_id, work_package_id, item_description, quantity, unit, requested_by, status)
values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e4',
        null, 'doc-chase fixture', 1, 'ea',
        '00000000-0000-0000-0000-0000000000e2', 'delivered');

-- 12–13 · note CHECK: reason 'other' demands a note; named reasons do not
select throws_ok($$
  insert into public.purchase_doc_waivers (purchase_request_id, reason, created_by)
  values ('00000000-0000-0000-0000-0000000000e5', 'other', '00000000-0000-0000-0000-0000000000e1')
$$, '23514', null, 'reason other without note refused by CHECK');
select lives_ok($$
  insert into public.purchase_doc_waivers (purchase_request_id, reason, created_by)
  values ('00000000-0000-0000-0000-0000000000e5', 'vendor_refused', '00000000-0000-0000-0000-0000000000e1')
$$, 'named reason inserts without note (owner path)');
delete from public.purchase_doc_waivers where purchase_request_id = '00000000-0000-0000-0000-0000000000e5';

-- 14–15 · default-grant hazard killed: anon/PUBLIC cannot execute (resolves inheritance)
select ok(not has_function_privilege('anon',
  'public.waive_purchase_docs(uuid, public.purchase_doc_waiver_reason, text)', 'EXECUTE'),
  'anon cannot execute waive_purchase_docs');
select ok(not has_function_privilege('anon',
  'public.unwaive_purchase_docs(uuid)', 'EXECUTE'),
  'anon cannot execute unwaive_purchase_docs');

-- allow role switches to write TAP
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';

-- 16–17 · procurement refused, both directions
select throws_ok($$
  select public.waive_purchase_docs('00000000-0000-0000-0000-0000000000e5', 'vendor_refused', null)
$$, '42501', 'waive_purchase_docs: role not permitted',
  'procurement cannot waive');
select throws_ok($$
  select public.unwaive_purchase_docs('00000000-0000-0000-0000-0000000000e5')
$$, '42501', 'unwaive_purchase_docs: role not permitted',
  'procurement cannot unwaive');

-- 17b · the coalesce-null branch: a subject with NO public.users row (role NULL)
-- must land in the same 42501, never fall through an unbound gate
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e9"}';
select throws_ok($$
  select public.waive_purchase_docs('00000000-0000-0000-0000-0000000000e5', 'vendor_refused', null)
$$, '42501', 'waive_purchase_docs: role not permitted',
  'unbound subject (no users row) refused, not silently admitted');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';

-- 18–21 · accounting positive control: waive, re-waive upserts, unknown PR refused
select lives_ok($$
  select public.waive_purchase_docs('00000000-0000-0000-0000-0000000000e5', 'vendor_refused', 'โทรแล้ว 3 ครั้ง')
$$, 'accounting waives');
select results_eq(
  $$select reason::text from public.purchase_doc_waivers
     where purchase_request_id = '00000000-0000-0000-0000-0000000000e5'$$,
  $$values ('vendor_refused')$$,
  'waiver row exists with the reason');
select lives_ok($$
  select public.waive_purchase_docs('00000000-0000-0000-0000-0000000000e5', 'docs_unobtainable', null)
$$, 're-waive upserts instead of erroring');
select results_eq(
  $$select reason::text from public.purchase_doc_waivers
     where purchase_request_id = '00000000-0000-0000-0000-0000000000e5'$$,
  $$values ('docs_unobtainable')$$,
  're-waive replaced the reason');

-- 21b · the OTHER read arm: procurement sees the waiver via parent-PR visibility
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';
select results_eq(
  $$select reason::text from public.purchase_doc_waivers
     where purchase_request_id = '00000000-0000-0000-0000-0000000000e5'$$,
  $$values ('docs_unobtainable')$$,
  'procurement reads the waiver through parent-PR visibility');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';

-- 22 · unknown PR refused with the pinned message
select throws_ok($$
  select public.waive_purchase_docs('00000000-0000-0000-0000-0000000000ee', 'vendor_refused', null)
$$, 'P0001', 'waive_purchase_docs: purchase request not found',
  'unknown purchase request refused');

-- 23 · unwaive removes the row
select lives_ok($$
  select public.unwaive_purchase_docs('00000000-0000-0000-0000-0000000000e5')
$$, 'accounting unwaives');

reset role;

-- 27 · the audit trail carries every state change: 2 waives + 1 unwaive.
-- Keyed by the payload's purchase_request_id (target_id is the WAIVER row id,
-- the audit lookup convention); event-sorted because all three rows share one
-- transaction timestamp and an unqualified sort is not stable.
select results_eq(
  $$select payload->>'event' from public.audit_log
     where target_table = 'purchase_doc_waivers'
       and payload->>'purchase_request_id' = '00000000-0000-0000-0000-0000000000e5'
     order by payload->>'event'$$,
  $$values ('purchase_docs_unwaived'), ('purchase_docs_waived'), ('purchase_docs_waived')$$,
  'audit rows for waive/rewaive/unwaive, PR id in payload');

select * from finish();
rollback;
