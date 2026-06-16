begin;
select plan(16);

-- ============================================================================
-- Spec 129 U1 — PEAK sync infrastructure: peak_sync_outbox + peak_sync_links +
-- enqueue_peak_sync. Mirrors the notification_outbox posture (ADR 0037): zero
-- user access (RLS on, no policies, privileges revoked) — the worker drains via
-- the service-role client; the only authenticated writer is the SECURITY
-- DEFINER enqueue RPC, staff-gated and idempotent per (source, operation).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110129', 'sa@peak.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220129', 'vi@peak.local', '{}'::jsonb);
update public.users set role = 'site_admin' where id = '11111111-1111-1111-1111-111111110129';
-- second user stays visitor

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'peak_sync_outbox', 'peak_sync_outbox exists');
select has_table('public', 'peak_sync_links', 'peak_sync_links exists');
select col_is_pk('public', 'peak_sync_outbox', 'id', 'outbox id is PK');
select enum_has_labels(
  'public', 'peak_sync_status',
  array['pending', 'sending', 'sent', 'failed', 'skipped'],
  'peak_sync_status labels');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.peak_sync_outbox'::regclass),
  'RLS enabled on peak_sync_outbox');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.peak_sync_links'::regclass),
  'RLS enabled on peak_sync_links');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'peak_sync_outbox'),
  0::bigint, 'peak_sync_outbox has no policies (zero access — worker only)');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'peak_sync_links'),
  0::bigint, 'peak_sync_links has no policies (zero access — worker only)');
select col_is_unique(
  'public', 'peak_sync_links',
  array['source_table', 'source_id', 'peak_doc_type'],
  'peak_sync_links is unique per (source_table, source_id, peak_doc_type)');

-- ============================================================================
-- B. Zero-grant posture: authenticated cannot read the outbox/links.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110129"}';
select throws_ok(
  $$ select status from public.peak_sync_outbox limit 1 $$,
  '42501', null, 'authenticated cannot read peak_sync_outbox (zero grant)');
select throws_ok(
  $$ select peak_doc_id from public.peak_sync_links limit 1 $$,
  '42501', null, 'authenticated cannot read peak_sync_links (zero grant)');

-- ============================================================================
-- C. enqueue_peak_sync: staff-gated + idempotent.
-- ============================================================================
-- visitor refused.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220129"}';
select throws_ok(
  $$ select public.enqueue_peak_sync('expense', 'dc_payments',
       '33333333-3333-3333-3333-333333330129', 'create', '{}'::jsonb) $$,
  '42501', null, 'enqueue_peak_sync refuses a non-staff role');

-- site_admin enqueues.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110129"}';
select lives_ok(
  $$ select public.enqueue_peak_sync('expense', 'dc_payments',
       '33333333-3333-3333-3333-333333330129', 'create',
       '{"amount": 570}'::jsonb) $$,
  'site_admin enqueues a PEAK sync job');
-- idempotent: the same (source, operation) again must NOT add a second row.
select lives_ok(
  $$ select public.enqueue_peak_sync('expense', 'dc_payments',
       '33333333-3333-3333-3333-333333330129', 'create', '{}'::jsonb) $$,
  're-enqueue of a live job is a no-op insert (returns the existing id)');

reset role;
select is(
  (select count(*) from public.peak_sync_outbox
    where source_table = 'dc_payments'
      and source_id = '33333333-3333-3333-3333-333333330129'),
  1::bigint, 'exactly one outbox row despite two enqueue calls (idempotent)');
select is(
  (select status from public.peak_sync_outbox
    where source_table = 'dc_payments'
      and source_id = '33333333-3333-3333-3333-333333330129'),
  'pending'::public.peak_sync_status, 'enqueued job starts pending');

select * from finish();
rollback;
