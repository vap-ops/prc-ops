begin;
select plan(5);

-- ============================================================================
-- Spec 321 U6 — a contractor's DOB joins the APPROVED identity tier (operator
-- decision 2026-07-16: "Approved tier, DOB-only" for every role). Spec 317 U3
-- deliberately left contractors out of decide_identity_change (a contractors row
-- is a firm/crew PARTY); U6 adds the DOB arm so a bound contractor's proposed DOB
-- is applied to public.contractors.date_of_birth on approve — resolved via the
-- same contractor_users binding current_user_contractor_id() uses. The instant
-- self-edit path (update_own_emergency_contact) no longer carries DOB.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000321', 'cdob@u.local', '{}'::jsonb),
  ('c2000000-0000-4000-8000-000000000321', 'noc@u.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110321', 'appr@u.local', '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = '11111111-1111-1111-1111-111111110321';
update public.users set role = 'contractor'         where id = 'c1000000-0000-4000-8000-000000000321';

insert into public.contractors (id, name, status, created_by) values
  ('cc000000-0000-4000-8000-000000000321', 'DOB Contractor', 'active', '11111111-1111-1111-1111-111111110321');
insert into public.contractor_users (user_id, contractor_id) values
  ('c1000000-0000-4000-8000-000000000321', 'cc000000-0000-4000-8000-000000000321');

-- one pending DOB-only identity request for the bound contractor, and one for a
-- login with NO contractor binding (must be a safe no-op on contractors).
insert into public.identity_change_requests (id, user_id, proposed_dob) values
  ('dd000000-0000-4000-8000-000000000321', 'c1000000-0000-4000-8000-000000000321', date '1988-03-15'),
  ('ee000000-0000-4000-8000-000000000321', 'c2000000-0000-4000-8000-000000000321', date '1979-11-02');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- approve as the staff-approval trio (procurement_manager)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110321"}';
select lives_ok(
  $$ select public.decide_identity_change('dd000000-0000-4000-8000-000000000321', true) $$,
  'the trio approves a contractor DOB identity change');
select lives_ok(
  $$ select public.decide_identity_change('ee000000-0000-4000-8000-000000000321', true) $$,
  'approving an identity change for a non-contractor login is a safe no-op');

reset role;
select is(
  (select date_of_birth from public.contractors where id = 'cc000000-0000-4000-8000-000000000321'),
  date '1988-03-15', 'approved DOB was applied to the bound contractor');
select is(
  (select status from public.identity_change_requests where id = 'dd000000-0000-4000-8000-000000000321')::text,
  'approved', 'the contractor identity request is marked approved');

-- the instant self-edit no longer carries DOB: the 4-arg overload is gone.
select hasnt_function(
  'public'::name, 'update_own_emergency_contact'::name,
  ARRAY['text', 'text', 'text', 'date'],
  'the instant DOB self-edit is removed (update_own_emergency_contact 4-arg gone)');

select * from finish();
rollback;
