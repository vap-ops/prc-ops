begin;
select plan(11);

-- ============================================================================
-- Spec 132 U1 — update_own_contractor_profile: a bound DC self-edits ONLY their
-- own contactability (phone/email/contact_person/mailing_address). An unbound
-- caller is refused; another contractor's row is untouched; and name/status/
-- tax_id are NEVER reached (the RPC writes only the four columns — so a DC cannot
-- un-blacklist itself or rewrite its legal payee name / tax id).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000154', 'ua@portal.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110154', 'pm@portal.local', '{}'::jsonb),
  ('99000000-0000-4000-8000-000000000154', 'vi@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110154';

insert into public.contractors (id, name, status, tax_id, created_by) values
  ('aa000000-0000-4000-8000-000000000154', 'Contractor A', 'blacklisted', '1234567890123',
   '11111111-1111-1111-1111-111111110154'),
  ('bb000000-0000-4000-8000-000000000154', 'Contractor B', 'active', null,
   '11111111-1111-1111-1111-111111110154');
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000154', 'aa000000-0000-4000-8000-000000000154');
update public.users set role = 'contractor' where id = 'a1000000-0000-4000-8000-000000000154';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000154"}';
select lives_ok(
  $$ select public.update_own_contractor_profile('0891112222', 'dc@example.com', 'สมชาย ใจดี', '123 ถนนสุขุมวิท') $$,
  'a bound contractor updates their own contactability');

reset role;
select is(
  (select phone from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  '0891112222', 'A''s phone was set');
select is(
  (select email from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  'dc@example.com', 'A''s email was set');
select is(
  (select contact_person from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  'สมชาย ใจดี', 'A''s contact person was set');
select is(
  (select mailing_address from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  '123 ถนนสุขุมวิท', 'A''s mailing address was set');

-- Column scope: identity / status / tax fields are NEVER reachable by the RPC.
select is(
  (select status::text from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  'blacklisted', 'A''s status is untouched (a DC cannot un-blacklist itself)');
select is(
  (select name from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  'Contractor A', 'A''s legal payee name is untouched');
select is(
  (select tax_id from public.contractors where id = 'aa000000-0000-4000-8000-000000000154'),
  '1234567890123', 'A''s tax_id is untouched (PM-only, from the ID card)');

select is(
  (select phone from public.contractors where id = 'bb000000-0000-4000-8000-000000000154'),
  null, 'B''s contactability is untouched');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000154"}';
select throws_ok(
  $$ select public.update_own_contractor_profile('0800000000', null, null, null) $$,
  '42501', null, 'an unbound visitor cannot self-edit');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110154"}';
select throws_ok(
  $$ select public.update_own_contractor_profile('0800000000', null, null, null) $$,
  '42501', null, 'staff without a contractor binding cannot use the self-edit RPC');

select * from finish();
rollback;
