-- Spec 284 U4 / ADR 0080 dec 10 — generalized document_approvals decision-log.
-- Additive: `document_approvals` (append-only decision ledger, TYPED contract_id FK)
-- + 2 enums (document_target_type, document_decision) + one SECURITY DEFINER RPC
-- submit_document_decision gated DOC_APPROVAL_ROLES (= LEGAL_ROLES: legal,
-- super_admin) FAIL-CLOSED via `is distinct from`. An 'approve' decision transitions
-- the contract draft→active in the same txn (mirrors how `approvals` drives WP state).
--
-- Invariants asserted:
--   * schema shape — the table + a TYPED contract_id FK, comment NOT NULL, and NO
--     mixed-content target_id column (CLAUDE.md L22: typed FKs, no polymorphic ref);
--   * zero authenticated grant (reads go via the service-role admin client behind
--     requireRole(DOC_APPROVAL_ROLES); the RLS client sees nothing);
--   * submit_document_decision FAIL-CLOSED for a null-role (unbound) caller AND for
--     a non-Legal authenticated session (visitor);
--   * anon has NO EXECUTE on the RPC (invariant 229 / the anon-default-priv trap —
--     brand-new fn revokes from public,anon inline);
--   * the Legal happy path — a legal user's 'approve' decision is logged AND flips a
--     draft contract to 'active'; a 'reject' is logged but does NOT transition;
--   * document_approvals is append-only (freeze trigger raises P0001 on UPDATE/DELETE
--     for every role, incl. the definer — the decision ledger is immutable = "audited").
begin;
select plan(17);

-- ---- fixture: a legal user + a visitor user + two draft contracts --------------
-- Inserting into auth.users fires the ADR-0007 trigger → a public.users row
-- (role 'visitor'); we promote the legal one. Contracts are inserted directly (the
-- default runner role is superuser → bypasses the zero-grant) so the decision tests
-- have known ids without capturing a generated one.
insert into auth.users (id, email, raw_user_meta_data) values
  ('84000000-0284-4284-8284-840000000284', 'legal@s284u4-test.local',   '{}'::jsonb),
  ('81000000-0284-4284-8284-810000000284', 'visitor@s284u4-test.local', '{}'::jsonb);
update public.users set role = 'legal' where id = '84000000-0284-4284-8284-840000000284';

insert into public.contracts (id, counterparty_type, counterparty_name, contract_type, title, status) values
  ('aa000000-0284-4000-8000-aa0000000284', 'client',     'ACME Co',    'client_agreement', 'MSA (approve path)',        'draft'),
  ('bb000000-0284-4000-8000-bb0000000284', 'contractor', 'Beta Build', 'subcontract',      'Foundation (reject path)',  'draft');

-- Assertions run while role=authenticated (sections D/F) must be able to write the
-- pgTAP collector — grant it up front or the whole file 42501s (tapbuf lesson).
grant insert, select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Schema.
-- ============================================================================
select has_table('public'::name, 'document_approvals'::name, 'document_approvals table exists');
select has_column('public'::name, 'document_approvals'::name, 'contract_id'::name,
  'document_approvals.contract_id (TYPED FK to contracts)');
select hasnt_column('public'::name, 'document_approvals'::name, 'target_id'::name,
  'document_approvals has NO mixed-content target_id column (CLAUDE.md L22)');
select col_not_null('public'::name, 'document_approvals'::name, 'comment'::name,
  'document_approvals.comment is NOT NULL (a decision must carry a reason)');
select col_not_null('public'::name, 'document_approvals'::name, 'contract_id'::name,
  'document_approvals.contract_id is NOT NULL (typed FK required)');
select ok((select relrowsecurity from pg_class where oid = 'public.document_approvals'::regclass),
  'RLS enabled on document_approvals');

-- ============================================================================
-- B. Zero-grant — no authenticated/anon table access (admin-client reads only).
-- ============================================================================
select ok(not has_table_privilege('anon', 'public.document_approvals', 'select'),
  'anon has no SELECT on document_approvals');
select ok(not has_table_privilege('authenticated', 'public.document_approvals', 'select'),
  'authenticated has no SELECT on document_approvals (zero-grant; admin-client reads)');

-- ============================================================================
-- C. submit_document_decision FAIL-CLOSED for a null-role (unbound) caller — the
--    default runner context has no auth.uid() → current_user_role() is null → the
--    `is distinct from` gate raises (never falls through).
-- ============================================================================
select throws_ok(
  $$ select public.submit_document_decision(gen_random_uuid(), 'approve', 'ok') $$,
  '42501', null, 'submit_document_decision forbidden for an unbound (null-role) caller');

-- ============================================================================
-- E. anon has NO EXECUTE on the RPC (invariant 229; the anon-default-priv trap).
-- ============================================================================
select ok(not has_function_privilege('anon',
  'public.submit_document_decision(uuid,public.document_decision,text)', 'execute'),
  'anon has no EXECUTE on submit_document_decision');

-- ============================================================================
-- D. A non-Legal authenticated session (visitor) is denied.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "81000000-0284-4284-8284-810000000284"}';
select throws_ok(
  $$ select public.submit_document_decision('aa000000-0284-4000-8000-aa0000000284', 'approve', 'x') $$,
  '42501', null, 'a non-Legal (visitor) session cannot submit_document_decision');

-- ============================================================================
-- F. The Legal happy path — approve logs + transitions; reject logs, no transition.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "84000000-0284-4284-8284-840000000284"}';
select ok(
  (select public.submit_document_decision('aa000000-0284-4000-8000-aa0000000284', 'approve', 'looks good')) is not null,
  'a legal user records an approve decision (returns the ledger id)');
select ok(
  (select public.submit_document_decision('bb000000-0284-4000-8000-bb0000000284', 'reject', 'missing signature')) is not null,
  'a legal user records a reject decision (returns the ledger id)');
reset role;

select is((select status::text from public.contracts where id = 'aa000000-0284-4000-8000-aa0000000284'),
  'active', 'approve transitions the draft contract to active (same txn)');
select is((select status::text from public.contracts where id = 'bb000000-0284-4000-8000-bb0000000284'),
  'draft', 'reject does NOT transition the contract (stays draft)');

-- ============================================================================
-- G. document_approvals is append-only (freeze trigger raises for every role).
-- ============================================================================
select throws_ok(
  $$ update public.document_approvals set comment = 'x' $$,
  'P0001', null, 'document_approvals is append-only: UPDATE blocked (freeze trigger)');
select throws_ok(
  $$ delete from public.document_approvals $$,
  'P0001', null, 'document_approvals is append-only: DELETE blocked (freeze trigger)');

select * from finish();
rollback;
