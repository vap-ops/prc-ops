begin;
select plan(5);

-- ============================================================================
-- Spec 321 (contractor-nullif follow-up) — update_own_contractor_profile
-- blank = keep. The RPC previously wrote nullif(btrim(p_x), '') into every
-- column, so a blank/omitted arg CLEARED the stored value — a partial edit
-- (e.g. change only the phone) wiped email + contact_person + mailing_address.
-- This is the same S2 silent data-loss class the worker RPC fixed in U3a. Pin
-- the coalesce-keep semantics: a blank/omitted arg PRESERVES the stored value,
-- mirroring update_own_worker_profile / update_own_staff_contact. Only an
-- explicit new value overwrites; a blank can never clear through this RPC.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000321', 'cbk@blankkeep.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110321', 'pmbk@blankkeep.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110321';

-- A contractor bound to that login (contractor_users), seeded with all four
-- contactability values so the keep-on-blank assertions have something to
-- preserve.
insert into public.contractors (id, name, status, tax_id, created_by,
   phone, email, contact_person, mailing_address) values
  ('aa000000-0000-4000-8000-000000000321', 'BK Contractor', 'active', null,
   '11111111-1111-1111-1111-111111110321',
   '0810000000', 'keep@c.local', 'สมชาย ใจดี', '123 ถนนสุขุมวิท');
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000321', 'aa000000-0000-4000-8000-000000000321');
update public.users set role = 'contractor' where id = 'a1000000-0000-4000-8000-000000000321';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- Act as the bound contractor; edit ONLY the phone, leave every other arg blank.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000321"}';
select lives_ok(
  $$ select public.update_own_contractor_profile('0812223333', '', '', '') $$,
  'bound contractor updates phone, leaves the other fields blank');

reset role;
-- The explicit new value overwrites.
select is((select phone from public.contractors where id = 'aa000000-0000-4000-8000-000000000321'),
  '0812223333', 'phone updated to the new value');
-- The blank args KEEP their stored values (RED on nullif-clear, GREEN on coalesce-keep).
select is((select email from public.contractors where id = 'aa000000-0000-4000-8000-000000000321'),
  'keep@c.local', 'blank email KEEPS the stored value (coalesce-keep, never clears)');
select is((select contact_person from public.contractors where id = 'aa000000-0000-4000-8000-000000000321'),
  'สมชาย ใจดี', 'blank contact person KEEPS the stored value');
select is((select mailing_address from public.contractors where id = 'aa000000-0000-4000-8000-000000000321'),
  '123 ถนนสุขุมวิท', 'blank mailing address KEEPS the stored value');

select * from finish();
rollback;
