begin;
select plan(10);

-- ============================================================================
-- A. Setup as postgres (RLS-bypass). Seed one PM (the requester) and one
--    project; insert three reports rows ordered by created_at so the FIFO
--    semantics are observable. The pgTAP runner's outer role is postgres,
--    which is also where the Railway worker effectively runs (service role
--    bypasses RLS the same way); we call claim_next_report() in that
--    context directly. The function itself is SECURITY DEFINER so it would
--    succeed under any granted role too, but service-role-from-postgres is
--    the faithful simulation of how Railway will invoke it.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'pm@claim-test.local', '{}'::jsonb);

update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   'PRC-TEST-CLAIM-A',
   'Claim fixture project');

-- Three requested reports + one already-complete report. The complete one
-- must never be claimed (only status='requested' rows are eligible).
-- created_at is explicit so FIFO order is deterministic.
insert into public.reports
  (id, project_id, status, requested_by, created_at)
values
  ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'requested',
   '33333333-3333-3333-3333-333333333333',
   '2026-01-01 00:00:00+00'),
  ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'requested',
   '33333333-3333-3333-3333-333333333333',
   '2026-01-02 00:00:00+00'),
  ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'requested',
   '33333333-3333-3333-3333-333333333333',
   '2026-01-03 00:00:00+00'),
  ('99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'complete',
   '33333333-3333-3333-3333-333333333333',
   '2026-01-04 00:00:00+00');

-- Grant the runner's temp result buffer to authenticated, so the assertion
-- in section C that runs under `set local role authenticated` can still
-- record its TAP output via the runner's `insert into _tap_buf(line) select
-- <pgtap>` rewrite. Same pattern established in 06-users-rls.test.sql.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: function exists, is SECURITY DEFINER, search_path pinned.
--    The five safety conditions from ADR 0011 apply here too — this is a
--    second SECURITY DEFINER helper, and the same review checklist is the
--    reason it gets these catalog assertions.
-- ============================================================================

select has_function(
  'public', 'claim_next_report',
  'public.claim_next_report() exists'
);

select is(
  (select prosecdef
     from pg_proc
     where oid = 'public.claim_next_report()'::regprocedure),
  true,
  'claim_next_report is SECURITY DEFINER'
);

-- search_path pinned to public — load-bearing for SECURITY DEFINER hygiene
-- so a future schema in the search_path can't intercept resolution.
select is(
  (select proconfig
     from pg_proc
     where oid = 'public.claim_next_report()'::regprocedure),
  array['search_path=public']::text[],
  'claim_next_report has search_path pinned to public'
);

-- ============================================================================
-- C. Authenticated role cannot execute the function. App users must NOT be
--    able to claim worker jobs — only the service role (and the postgres
--    role here) executes it. EXECUTE is granted to service_role only; the
--    default revocation of EXECUTE from PUBLIC together with the missing
--    authenticated grant should produce SQLSTATE 42501.
-- ============================================================================

-- Postgres grants EXECUTE on functions to PUBLIC by default, so the
-- migration must explicitly REVOKE that grant for the privilege denial to
-- bite. We assert the denial here under the authenticated role.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

select throws_ok(
  $$ select public.claim_next_report() $$,
  '42501',
  null,
  'authenticated role cannot execute claim_next_report (no grant)'
);

reset role;

-- ============================================================================
-- D. Claim semantics under the worker's running context (postgres /
--    service-role equivalent in pgTAP). FIFO by created_at, flips
--    requested → processing, returns exactly the claimed row.
-- ============================================================================

-- D.1 first claim returns the oldest requested row, flips it to processing.
select is(
  (select (public.claim_next_report()).id),
  '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'first claim returns the oldest requested row (FIFO by created_at)'
);

select is(
  (select status::text from public.reports
     where id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'processing',
  'first claim flipped that row to status=processing'
);

-- D.2 second claim returns the next-oldest requested row, leaving the
--     first one in processing.
select is(
  (select (public.claim_next_report()).id),
  '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'second claim returns the second-oldest requested row'
);

-- D.3 third claim returns the third (and last) requested row.
select is(
  (select (public.claim_next_report()).id),
  '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'third claim returns the third (and last) requested row'
);

-- D.4 fourth claim returns no row at all — the complete row is NOT
--     eligible. claim_next_report() RETURNS SETOF reports, so the row
--     count from select * is 0 when nothing claimable remains.
select is(
  (select count(*)::int from public.claim_next_report()),
  0,
  'fourth claim returns no row (no requested rows; complete row ignored)'
);

-- D.5 the complete row's status was never touched by the loop above.
select is(
  (select status::text from public.reports
     where id = '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'complete',
  'pre-existing complete row was never claimed (status unchanged)'
);

-- ============================================================================
-- E. Tear down. reset role was issued before section D so finish() runs
--    under postgres with full privileges. The rollback at end-of-test is
--    the belt-and-braces backstop.
-- ============================================================================

select * from finish();
rollback;
