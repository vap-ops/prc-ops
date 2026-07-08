-- Spec 284 U3 / ADR 0080 dec 10 — Legal contracts on the money/document posture.
-- Additive: `contracts` + `contract_attachments` (append-only + supersede) + 4
-- SECURITY DEFINER RPCs (create_/update_/void_contract, add_contract_attachment)
-- gated LEGAL_ROLES (legal, super_admin) FAIL-CLOSED via `is distinct from`.
--
-- Invariants asserted:
--   * schema shape — both tables + counterparty_name, and NO mixed-content
--     counterparty_id column (CLAUDE.md L22: typed FKs, no polymorphic ref cols);
--   * zero authenticated grant (reads go via the service-role admin client behind
--     requireRole(LEGAL_ROLES); the RLS client sees nothing);
--   * every write RPC FAIL-CLOSED for a null-role (unbound) caller AND for a
--     non-Legal authenticated session (visitor);
--   * anon has NO EXECUTE on any of the 4 RPCs (invariant 229 / the anon-default-
--     privilege trap — brand-new fns revoke from public,anon inline);
--   * the Legal happy path — a legal user creates a contract, attaches a document,
--     and voids it; void SETS status='void' (never DELETE — the row persists);
--   * contract_attachments is append-only (block trigger raises on UPDATE/DELETE
--     for every role, incl. the definer).
begin;
select plan(25);

-- ---- fixture: a legal user + a visitor user + one pre-inserted draft contract --
-- Inserting into auth.users fires the ADR-0007 trigger → a public.users row
-- (role 'visitor'); we promote the legal one. The contract is inserted directly
-- (the default runner role is superuser → bypasses the zero-grant) so the void /
-- attachment tests have a known id without capturing a generated one.
insert into auth.users (id, email, raw_user_meta_data) values
  ('84000000-0284-4284-8284-840000000284', 'legal@s284-test.local',   '{}'::jsonb),
  ('81000000-0284-4284-8284-810000000284', 'visitor@s284-test.local', '{}'::jsonb);
update public.users set role = 'legal' where id = '84000000-0284-4284-8284-840000000284';

insert into public.contracts (id, counterparty_type, counterparty_name, contract_type, title, status)
values ('cc000000-0284-4000-8000-cc0000000284', 'client', 'ACME Co',
        'client_agreement', 'Master Services Agreement', 'draft');

-- Assertions run while role=authenticated (sections D/F) must be able to write the
-- pgTAP collector — grant it up front or the whole file 42501s (tapbuf lesson).
grant insert, select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Schema.
-- ============================================================================
select has_table('public'::name, 'contracts'::name, 'contracts table exists');
select has_table('public'::name, 'contract_attachments'::name, 'contract_attachments table exists');
select has_column('public'::name, 'contracts'::name, 'counterparty_name'::name,
  'contracts.counterparty_name (denormalized display; no mixed-content id)');
select hasnt_column('public'::name, 'contracts'::name, 'counterparty_id'::name,
  'contracts has NO mixed-content counterparty_id column (CLAUDE.md L22)');
select ok((select relrowsecurity from pg_class where oid = 'public.contracts'::regclass),
  'RLS enabled on contracts');
select ok((select relrowsecurity from pg_class where oid = 'public.contract_attachments'::regclass),
  'RLS enabled on contract_attachments');

-- ============================================================================
-- B. Zero-grant — no authenticated/anon table access (admin-client reads only).
-- ============================================================================
select ok(not has_table_privilege('anon', 'public.contracts', 'select'),
  'anon has no SELECT on contracts');
select ok(not has_table_privilege('authenticated', 'public.contracts', 'select'),
  'authenticated has no SELECT on contracts (zero-grant; admin-client reads)');
select ok(not has_table_privilege('authenticated', 'public.contract_attachments', 'select'),
  'authenticated has no SELECT on contract_attachments (zero-grant)');

-- ============================================================================
-- C. Write RPCs FAIL-CLOSED for a null-role (unbound) caller — the default
--    runner context has no auth.uid() → current_user_role() is null → the
--    `is distinct from` gate raises (never falls through).
-- ============================================================================
select throws_ok(
  $$ select public.create_contract('client', 'ACME', 'client_agreement', 'MSA') $$,
  '42501', null, 'create_contract forbidden for an unbound (null-role) caller');
select throws_ok(
  $$ select public.update_contract('00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501', null, 'update_contract forbidden for an unbound (null-role) caller');
select throws_ok(
  $$ select public.void_contract('00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501', null, 'void_contract forbidden for an unbound (null-role) caller');
select throws_ok(
  $$ select public.add_contract_attachment('00000000-0000-0000-0000-000000000000'::uuid, 'p/x.pdf') $$,
  '42501', null, 'add_contract_attachment forbidden for an unbound (null-role) caller');

-- ============================================================================
-- E. anon has NO EXECUTE on any RPC (invariant 229; the anon-default-priv trap).
-- ============================================================================
select ok(not has_function_privilege('anon',
  'public.create_contract(public.contract_counterparty_type,text,public.contract_type,text,uuid,numeric)', 'execute'),
  'anon has no EXECUTE on create_contract');
select ok(not has_function_privilege('anon',
  'public.update_contract(uuid,text,uuid,text,numeric,date,date,date,public.contract_status,text)', 'execute'),
  'anon has no EXECUTE on update_contract');
select ok(not has_function_privilege('anon', 'public.void_contract(uuid)', 'execute'),
  'anon has no EXECUTE on void_contract');
select ok(not has_function_privilege('anon', 'public.add_contract_attachment(uuid,text)', 'execute'),
  'anon has no EXECUTE on add_contract_attachment');

-- ============================================================================
-- D. A non-Legal authenticated session (visitor) is denied.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "81000000-0284-4284-8284-810000000284"}';
select throws_ok(
  $$ select public.create_contract('client', 'ACME', 'client_agreement', 'MSA') $$,
  '42501', null, 'a non-Legal (visitor) session cannot create_contract');

-- ============================================================================
-- F. The Legal happy path — create, attach, void (as a legal-role session).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "84000000-0284-4284-8284-840000000284"}';
select ok(
  (select public.create_contract('contractor', 'Beta Build Co', 'subcontract', 'Foundation package', null, 250000)) is not null,
  'a legal user creates a contract via create_contract');
select ok(
  (select public.add_contract_attachment('cc000000-0284-4000-8000-cc0000000284', 'legal/contracts/cc/deed.pdf')) is not null,
  'a legal user attaches a document via add_contract_attachment');
select lives_ok(
  $$ select public.void_contract('cc000000-0284-4000-8000-cc0000000284') $$,
  'a legal user voids a contract via void_contract');
reset role;

-- ============================================================================
-- G. void SETS status (never DELETE), and attachments are append-only.
-- ============================================================================
select is((select status::text from public.contracts where id = 'cc000000-0284-4000-8000-cc0000000284'),
  'void', 'void_contract sets status=void (not a DELETE)');
select is((select count(*)::int from public.contracts where id = 'cc000000-0284-4000-8000-cc0000000284'),
  1, 'the voided contract row still exists (append-only spirit — no row loss)');
select throws_ok(
  $$ update public.contract_attachments set storage_path = 'x' where contract_id = 'cc000000-0284-4000-8000-cc0000000284' $$,
  'P0001', null, 'contract_attachments is append-only: UPDATE blocked (block trigger)');
select throws_ok(
  $$ delete from public.contract_attachments where contract_id = 'cc000000-0284-4000-8000-cc0000000284' $$,
  'P0001', null, 'contract_attachments is append-only: DELETE blocked (block trigger)');

select * from finish();
rollback;
