begin;
select plan(6);

-- ============================================================================
-- Spec 131 U2b — update_own_emergency_contact: a bound DC self-edits ONLY their
-- own emergency contact + DOB; an unbound caller (visitor or staff w/o a
-- binding) is refused; another contractor's row is untouched; status/tax_id are
-- never reachable (the RPC writes only the four columns).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000152', 'ua@portal.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110152', 'pm@portal.local', '{}'::jsonb),
  ('99000000-0000-4000-8000-000000000152', 'vi@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110152';

insert into public.contractors (id, name, status, created_by) values
  ('aa000000-0000-4000-8000-000000000152', 'Contractor A', 'active', '11111111-1111-1111-1111-111111110152'),
  ('bb000000-0000-4000-8000-000000000152', 'Contractor B', 'active', '11111111-1111-1111-1111-111111110152');
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000152', 'aa000000-0000-4000-8000-000000000152');
update public.users set role = 'contractor' where id = 'a1000000-0000-4000-8000-000000000152';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000152"}';
select lives_ok(
  $$ select public.update_own_emergency_contact('ผู้ติดต่อ ก', 'พี่', '0891112222', date '1990-05-01') $$,
  'a bound contractor updates their own emergency contact');

reset role;
select is(
  (select emergency_contact_name from public.contractors where id = 'aa000000-0000-4000-8000-000000000152'),
  'ผู้ติดต่อ ก', 'A''s emergency contact name was set');
select is(
  (select date_of_birth from public.contractors where id = 'aa000000-0000-4000-8000-000000000152'),
  date '1990-05-01', 'A''s DOB was set');
select is(
  (select emergency_contact_name from public.contractors where id = 'bb000000-0000-4000-8000-000000000152'),
  null, 'B''s emergency contact is untouched');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000152"}';
select throws_ok(
  $$ select public.update_own_emergency_contact('x', 'y', '0800000000') $$,
  '42501', null, 'an unbound visitor cannot self-edit');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110152"}';
select throws_ok(
  $$ select public.update_own_emergency_contact('x', 'y', '0800000000') $$,
  '42501', null, 'staff without a contractor binding cannot use the self-edit RPC');

select * from finish();
rollback;
