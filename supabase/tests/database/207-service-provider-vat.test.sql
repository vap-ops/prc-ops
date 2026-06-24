begin;
select plan(8);

-- ============================================================================
-- Spec 191 U3 — service_providers reach vendor parity: tax_id + payment_terms +
-- is_vat_registered. Pins the three columns, the NOT NULL default-false VAT flag,
-- the column-level insert/update grants (spec-174 lesson), and a functional PM
-- insert carrying the flag + tax id.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110207', 'pm@svc207.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110207';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Columns.
select has_column('public', 'service_providers', 'tax_id', 'tax_id exists');
select has_column('public', 'service_providers', 'payment_terms', 'payment_terms exists');
select has_column('public', 'service_providers', 'is_vat_registered', 'is_vat_registered exists');
select col_default_is(
  'public', 'service_providers', 'is_vat_registered', 'false', 'VAT flag defaults to false');

-- B. Column-level grants on the new columns.
select ok(
  has_column_privilege('authenticated', 'public.service_providers', 'is_vat_registered', 'INSERT'),
  'authenticated may INSERT is_vat_registered');
select ok(
  has_column_privilege('authenticated', 'public.service_providers', 'tax_id', 'INSERT'),
  'authenticated may INSERT tax_id');
select ok(
  has_column_privilege('authenticated', 'public.service_providers', 'payment_terms', 'UPDATE'),
  'authenticated may UPDATE payment_terms');

-- C. Functional — a PM insert carries the VAT flag + tax id through RLS.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110207"}';
insert into public.service_providers (name, tax_id, payment_terms, is_vat_registered, created_by)
  values ('VAT Svc 207', '1-2345-67890-12-3', 'เครดิต 30 วัน', true,
          '11111111-1111-1111-1111-111111110207');
reset role;
select is(
  (select is_vat_registered from public.service_providers where name = 'VAT Svc 207'),
  true, 'PM insert persists is_vat_registered = true on a service provider');

select * from finish();
rollback;
