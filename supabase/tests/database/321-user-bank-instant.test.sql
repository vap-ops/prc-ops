begin;
select plan(4);

-- ============================================================================
-- Spec 321 U8a — record_own_user_bank: the login(user_id)-keyed bank home goes
-- INSTANT (no approval). A DEFINER RPC that upserts public.user_bank for
-- auth.uid() directly, keeping the SAME single-home guard (worker / contractor /
-- approved-staff own their bank elsewhere) + passbook path pin + storage-object
-- check as the (now-retired) submit_user_bank_change/decide flow. Only the
-- approval queue is dropped — the guards are identical.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1110000-0000-4000-8000-000000000821', 'homeless@t821.local', '{}'::jsonb),
  ('a3330000-0000-4000-8000-000000000821', 'boundwkr@t821.local', '{}'::jsonb),
  ('b1110000-0000-4000-8000-000000000821', 'pm@t821.local',       '{}'::jsonb);
update public.users set role = 'accounting'      where id = 'a1110000-0000-4000-8000-000000000821';
update public.users set role = 'technician'      where id = 'a3330000-0000-4000-8000-000000000821';
update public.users set role = 'project_manager' where id = 'b1110000-0000-4000-8000-000000000821';

-- boundwkr is a BOUND worker → their bank home is the worker flow, so the login
-- instant flow must refuse them (the single-home guard).
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('c3330000-0000-4000-8000-000000000821', 'ช่าง ผูก', 'daily', 'temporary', 500,
   'a3330000-0000-4000-8000-000000000821', 'b1110000-0000-4000-8000-000000000821');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select has_function('public', 'record_own_user_bank', array['text', 'text', 'text', 'text'],
  'record_own_user_bank(text,text,text,text) exists');

-- passbook object at the caller's own pinned path (reuses the spec 315 U2 path).
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a1110000-0000-4000-8000-000000000821/book_bank/pass.jpg');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1110000-0000-4000-8000-000000000821"}';
select lives_ok(
  $$ select public.record_own_user_bank('กสิกรไทย', '999-888 7776', 'โฮมเลส หนึ่ง',
       'technician/a1110000-0000-4000-8000-000000000821/book_bank/pass.jpg') $$,
  'a home-less login records their bank INSTANTLY (no approval queue)');

-- a bound worker is refused by the single-home guard (before any storage check).
set local "request.jwt.claims" = '{"sub": "a3330000-0000-4000-8000-000000000821"}';
select throws_ok(
  $$ select public.record_own_user_bank('ออมสิน', '5556667778', 'ช่าง ผูก',
       'technician/a3330000-0000-4000-8000-000000000821/book_bank/pass.jpg') $$,
  '42501', null, 'a bound worker cannot use the login instant bank flow');

reset role;
-- the write landed directly on user_bank (dashes/spaces normalized), no queue row.
select is(
  (select bank_name || '|' || bank_account_number from public.user_bank
    where user_id = 'a1110000-0000-4000-8000-000000000821'),
  'กสิกรไทย|9998887776', 'record_own_user_bank upserts user_bank with the normalized account');

select * from finish();
rollback;
