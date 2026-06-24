begin;
select plan(7);

-- ============================================================================
-- Spec 191 U2 — suppliers.is_vat_registered. Pins the column shape, the NOT NULL
-- default-false posture, the column-level insert/update grants (spec-174 lesson),
-- and a functional back-office insert carrying the flag.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110206', 'bo@vat206.local', '{}'::jsonb);
update public.users set role = 'procurement' where id = '11111111-1111-1111-1111-111111110206';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Column shape.
select has_column('public', 'suppliers', 'is_vat_registered', 'is_vat_registered exists');
select col_type_is('public', 'suppliers', 'is_vat_registered', 'boolean', 'is boolean');
select col_not_null('public', 'suppliers', 'is_vat_registered', 'is NOT NULL');
select col_default_is(
  'public', 'suppliers', 'is_vat_registered', 'false', 'defaults to false');

-- B. Column-level grants — a new column inherits none (spec 174), so they were
--    added explicitly. The direct insert/update path needs both.
select ok(
  has_column_privilege('authenticated', 'public.suppliers', 'is_vat_registered', 'INSERT'),
  'authenticated may INSERT the is_vat_registered column');
select ok(
  has_column_privilege('authenticated', 'public.suppliers', 'is_vat_registered', 'UPDATE'),
  'authenticated may UPDATE the is_vat_registered column');

-- C. Functional — a back-office supplier insert carries the flag through RLS.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110206"}';
insert into public.suppliers (name, tax_id, is_vat_registered, created_by)
  values ('VAT Co 206', '1-2345-67890-12-3', true, '11111111-1111-1111-1111-111111110206');
reset role;
select is(
  (select is_vat_registered from public.suppliers where name = 'VAT Co 206'),
  true, 'back-office insert persists is_vat_registered = true');

select * from finish();
rollback;
