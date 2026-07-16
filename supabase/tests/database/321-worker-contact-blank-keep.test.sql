begin;
select plan(6);

-- ============================================================================
-- Spec 321 U3a — update_own_worker_profile blank = keep (fixes S2 silent
-- data-loss). The RPC previously wrote nullif(btrim(p_x), '') into every
-- column, so a blank/omitted arg CLEARED the stored value — a partial edit
-- (e.g. change only the phone) wiped email + emergency contact. This pins the
-- coalesce-keep semantics: a blank/omitted arg PRESERVES the stored value,
-- mirroring the sibling update_own_staff_contact (spec 317). Only an explicit
-- new value overwrites; a blank can never clear through this RPC.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555550321', 'wbk@blankkeep.local', '{}'::jsonb);
update public.users set role = 'contractor' where id = '55555555-5555-5555-5555-555555550321';

-- A worker bound to that login (workers.user_id), seeded with contact +
-- emergency-contact values so the keep-on-blank assertions have something to
-- preserve.
insert into public.workers
  (id, name, pay_type, employment_type, day_rate, active, created_by,
   phone, email, emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
   user_id)
values
  ('aa000003-0000-4000-8000-000000000321', 'BK Worker', 'daily', 'permanent', 400.00, true,
   '55555555-5555-5555-5555-555555550321',
   '0810000000', 'keep@e.local', 'ชื่อฉุกเฉิน', 'พี่สาว', '0899999999',
   '55555555-5555-5555-5555-555555550321');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- Act as the bound worker; edit ONLY the phone, leave every other arg blank.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550321"}';
select lives_ok(
  $$ select public.update_own_worker_profile('0812223333', '', '', '', '') $$,
  'bound worker updates phone, leaves the other fields blank');

reset role;
-- The explicit new value overwrites.
select is((select phone from public.workers where id = 'aa000003-0000-4000-8000-000000000321'),
  '0812223333', 'phone updated to the new value');
-- The blank args KEEP their stored values (RED on nullif-clear, GREEN on coalesce-keep).
select is((select email from public.workers where id = 'aa000003-0000-4000-8000-000000000321'),
  'keep@e.local', 'blank email KEEPS the stored value (coalesce-keep, never clears)');
select is((select emergency_contact_name from public.workers where id = 'aa000003-0000-4000-8000-000000000321'),
  'ชื่อฉุกเฉิน', 'blank emergency name KEEPS the stored value');
select is((select emergency_contact_relation from public.workers where id = 'aa000003-0000-4000-8000-000000000321'),
  'พี่สาว', 'blank emergency relation KEEPS the stored value');
select is((select emergency_contact_phone from public.workers where id = 'aa000003-0000-4000-8000-000000000321'),
  '0899999999', 'blank emergency phone KEEPS the stored value');

select * from finish();
rollback;
