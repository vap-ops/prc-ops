begin;
select plan(20);

-- ============================================================================
-- Spec 396 U1 — update_worker records the PREVIOUS value in its worker_change
-- audit payload.
--
-- Why: on 2026-08-04 a real employee's record was renamed to a different
-- person's name in prod. The change was detectable in audit_log but NOT
-- reversible from it — the row carried only the NEW name. The original was
-- recoverable purely by luck, because an approved staff_registrations row still
-- held it; a worker created any other way would have been unrecoverable.
--
-- Contract pinned here: for each identity field update_worker actually CHANGES,
-- the payload gains "<field>_before". The key is ABSENT when the field does not
-- change, so its PRESENCE means "this field moved" and never "a value was
-- passed". audit_log stays append-only — only what a NEW row contains changes.
--
-- ⚠️ ORDERING: audit_log.created_at is transaction-constant, so every row this
-- test writes shares one timestamp and `order by created_at desc limit 1` picks
-- an ARBITRARY row among ties (observed live — an earlier draft mislabelled its
-- own cases because of it). Every assertion below is order-independent: one
-- worker fixture per case, and the two-write case asserts over the SET.
--
-- ⚠️ NULLABLE FIELDS: workers.gender is nullable, so an unset→set transition
-- emits "gender_before": null — the KEY is present with a JSON null value.
-- `payload->>'x'` cannot distinguish that from an absent key, so the only valid
-- probe for "did this field move" is `payload ? 'x'`. Pinned by ง below.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110396', 'proc@w396.local', '{}'::jsonb);
update public.users set role = 'procurement'
  where id = '11111111-1111-1111-1111-111111110396';

insert into public.workers (id, name, pay_type, employment_type, day_rate, active,
                            gender, note, phone, bank_account_number, created_by) values
  ('aa000001-0000-4000-8000-000000000396', 'ก เดิม', 'daily', 'temporary', 400.00,
   true, 'female', 'โน้ตเดิม', '0800000001', '1234567890',
   '11111111-1111-1111-1111-111111110396'),
  ('aa000002-0000-4000-8000-000000000396', 'ข เดิม', 'daily', 'temporary', 400.00,
   true, 'female', null, null, null, '11111111-1111-1111-1111-111111110396'),
  ('aa000003-0000-4000-8000-000000000396', 'ค เดิม', 'daily', 'temporary', 400.00,
   true, 'female', null, null, null, '11111111-1111-1111-1111-111111110396'),
  ('aa000004-0000-4000-8000-000000000396', 'ง เดิม', 'daily', 'temporary', 400.00,
   true, null, null, null, null, '11111111-1111-1111-1111-111111110396'),
  ('aa000005-0000-4000-8000-000000000396', 'จ เดิม', 'daily', 'temporary', 400.00,
   true, 'female', null, null, null, '11111111-1111-1111-1111-111111110396');

-- The runner rewrites each assertion into `insert into _tap_buf(line) select
-- <pgtap>`, so an assertion evaluated under a switched role needs write access
-- to that collector (house idiom, 06-users-rls.test.sql:24-27). `authenticated`
-- cannot grant to itself, so this must precede the role switch; all of it dies
-- with the enclosing rollback.
grant insert on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110396"}';

select lives_ok(
  $$select public.update_worker(
      p_id => 'aa000001-0000-4000-8000-000000000396', p_name => 'ก ใหม่')$$,
  'procurement may rename a worker (this unit does not change the gate)');
select lives_ok(
  $$select public.update_worker(
      p_id => 'aa000002-0000-4000-8000-000000000396', p_name => 'ข ใหม่')$$,
  'second fixture renamed');
select lives_ok(
  $$select public.update_worker(
      p_id => 'aa000002-0000-4000-8000-000000000396', p_name => 'ข ใหม่')$$,
  're-saving the identical name succeeds');
select lives_ok(
  $$select public.update_worker(
      p_id => 'aa000003-0000-4000-8000-000000000396', p_gender => 'male')$$,
  'gender may be changed');
select lives_ok(
  $$select public.update_worker(
      p_id => 'aa000004-0000-4000-8000-000000000396', p_gender => 'male')$$,
  'gender may be set on a worker whose gender was NULL');
select lives_ok(
  $$select public.update_worker(
      p_id             => 'aa000005-0000-4000-8000-000000000396',
      p_active         => false,
      p_pay_type       => 'monthly',
      p_employment_type => 'permanent')$$,
  'active + pay_type + employment_type may be changed together');

reset role;

-- ---------------------------------------------------------------------------
-- ก — the rename records both sides, and the UPDATE itself is unchanged.
-- ---------------------------------------------------------------------------
select is(
  (select payload->>'name_before' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000001-0000-4000-8000-000000000396'),
  'ก เดิม', 'a rename records name_before = the previous name');

select is(
  (select payload->>'name' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000001-0000-4000-8000-000000000396'),
  'ก ใหม่', 'the pre-existing "name" key still carries the new name');

-- Guards the half of this migration that is supposed to be a no-op: the whole
-- UPDATE statement was carried over verbatim, and the payload is built from the
-- PARAMETERS, so a dropped coalesce arm or a mangled note CASE would leave every
-- payload assertion above green.
select is(
  (select name || '|' || coalesce(note, '(null)') || '|' || coalesce(phone, '(null)')
          || '|' || coalesce(bank_account_number, '(null)')
     from public.workers where id = 'aa000001-0000-4000-8000-000000000396'),
  'ก ใหม่|โน้ตเดิม|0800000001|1234567890',
  'the rename changed ONLY the name — note/phone/bank preserved (UPDATE unchanged)');

-- ---------------------------------------------------------------------------
-- ข — two writes; only the one that moved the name carries name_before.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.audit_log
    where action = 'worker_change' and target_id = 'aa000002-0000-4000-8000-000000000396'),
  2::bigint, 'two saves wrote two audit rows');

select is(
  (select count(*) from public.audit_log
    where action = 'worker_change' and target_id = 'aa000002-0000-4000-8000-000000000396'
      and payload ? 'name_before'),
  1::bigint, 'exactly ONE of the two carries name_before — a no-op save claims no change');

-- ---------------------------------------------------------------------------
-- ค — another field, asserted separately so a failure names itself.
-- ---------------------------------------------------------------------------
select is(
  (select payload->>'gender_before' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000003-0000-4000-8000-000000000396'),
  'female', 'gender change records gender_before');

select ok(
  not ((select payload from public.audit_log
         where action = 'worker_change'
           and target_id = 'aa000003-0000-4000-8000-000000000396') ? 'name_before'),
  'a gender-only change adds no name_before key');

select ok(
  not ((select payload from public.audit_log
         where action = 'worker_change'
           and target_id = 'aa000003-0000-4000-8000-000000000396') ? 'employment_type_before'),
  'a gender-only change adds no employment_type_before key');

-- ---------------------------------------------------------------------------
-- ง — NULL→value: the KEY is present, its VALUE is null. Presence is the probe.
-- ---------------------------------------------------------------------------
select ok(
  (select payload from public.audit_log
    where action = 'worker_change'
      and target_id = 'aa000004-0000-4000-8000-000000000396') ? 'gender_before',
  'setting a previously-NULL field still records the key (the field DID move)');

select is(
  (select payload->>'gender_before' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000004-0000-4000-8000-000000000396'),
  null, 'and its value is null — so `?` presence, not `->>`, is the valid probe');

-- ---------------------------------------------------------------------------
-- จ — the remaining three arms, each pinned separately (a typo in any one of
--     the jsonb keys would otherwise ship green).
-- ---------------------------------------------------------------------------
select is(
  (select payload->>'active_before' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000005-0000-4000-8000-000000000396'),
  'true', 'active change records active_before');

select is(
  (select payload->>'pay_type_before' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000005-0000-4000-8000-000000000396'),
  'daily', 'pay_type change records pay_type_before');

select is(
  (select payload->>'employment_type_before' from public.audit_log
    where action = 'worker_change' and target_id = 'aa000005-0000-4000-8000-000000000396'),
  'temporary', 'employment_type change records employment_type_before');

select ok(
  not ((select payload from public.audit_log
         where action = 'worker_change'
           and target_id = 'aa000005-0000-4000-8000-000000000396') ? 'gender_before'),
  'and the untouched gender adds no key on that same row');

select * from finish();
rollback;
