begin;
select plan(15);

-- ============================================================================
-- Spec 131 U1 — DC onboarding packet: doc-type additions, emergency-contact /
-- DOB columns, and the contractor_consents record (dated, revocable; PDPA).
-- Pins the consent record/revoke gates (self OR staff to record; self OR
-- pm/super to revoke; an unrelated party refused) and its read scoping.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000131', 'ua@portal.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110131', 'pm@portal.local', '{}'::jsonb),
  ('99000000-0000-4000-8000-000000000131', 'vi@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110131';
-- vis stays visitor.

insert into public.contractors (id, name, created_by) values
  ('aa000000-0000-4000-8000-000000000131', 'Contractor A', '11111111-1111-1111-1111-111111110131'),
  ('bb000000-0000-4000-8000-000000000131', 'Contractor B', '11111111-1111-1111-1111-111111110131');
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000131', 'aa000000-0000-4000-8000-000000000131');
update public.users set role = 'contractor' where id = 'a1000000-0000-4000-8000-000000000131';

-- A consent seeded directly (known id) for the revoke-denied test.
insert into public.contractor_consents (id, contractor_id, kind, recorded_by) values
  ('cc000000-0000-4000-8000-000000000131', 'aa000000-0000-4000-8000-000000000131',
   'pdpa_data', '11111111-1111-1111-1111-111111110131');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog.
select has_table('public', 'contractor_consents', 'contractor_consents exists');
select enum_has_labels('public', 'contractor_consent_kind',
  array['pdpa_data', 'background_check'], 'contractor_consent_kind labels');
select has_column('public', 'contractors', 'emergency_contact_name', 'emergency_contact_name column');
select has_column('public', 'contractors', 'date_of_birth', 'date_of_birth column');
select lives_ok($$ select 'consent'::public.contact_doc_purpose $$,
  'contact_doc_purpose gained the consent value');

-- B. record_contractor_consent gates.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000131"}';
select isnt(
  (select public.record_contractor_consent('aa000000-0000-4000-8000-000000000131', 'background_check')),
  null, 'a bound contractor records their own consent');

set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000131"}';
select throws_ok(
  $$ select public.record_contractor_consent('aa000000-0000-4000-8000-000000000131', 'pdpa_data') $$,
  '42501', null, 'a non-bound non-staff user cannot record consent');

set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000131"}';
select throws_ok(
  $$ select public.record_contractor_consent('bb000000-0000-4000-8000-000000000131', 'pdpa_data') $$,
  '42501', null, 'a contractor cannot record consent for another contractor');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110131"}';
select isnt(
  (select public.record_contractor_consent('aa000000-0000-4000-8000-000000000131', 'pdpa_data')),
  null, 'staff records consent on a contractor''s behalf');

-- C. read scoping (A now has: seeded pdpa + uA bg + pm pdpa = 3).
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000131"}';
select is((select count(*) from public.contractor_consents),
  3::bigint, 'bound contractor sees their own consents');
set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000131"}';
select is((select count(*) from public.contractor_consents),
  0::bigint, 'an unbound visitor sees no consents');

-- D. revoke.
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000131"}';
select lives_ok(
  $$ select public.revoke_contractor_consent(
       (select id from public.contractor_consents
         where contractor_id = 'aa000000-0000-4000-8000-000000000131'
           and kind = 'background_check')) $$,
  'a contractor revokes their own consent (PDPA withdrawal)');

reset role;
select isnt(
  (select revoked_at from public.contractor_consents
    where contractor_id = 'aa000000-0000-4000-8000-000000000131' and kind = 'background_check'),
  null, 'the revoked consent carries revoked_at');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "99000000-0000-4000-8000-000000000131"}';
select throws_ok(
  $$ select public.revoke_contractor_consent('cc000000-0000-4000-8000-000000000131') $$,
  '42501', null, 'an unrelated party cannot revoke a consent');

reset role;
select is(
  (select revoked_at from public.contractor_consents
    where id = 'cc000000-0000-4000-8000-000000000131'),
  null, 'the denied revoke left the consent intact');

select * from finish();
rollback;
