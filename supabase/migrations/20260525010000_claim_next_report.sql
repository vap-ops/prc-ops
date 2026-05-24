-- Atomic job-claim RPC for the Railway PDF report worker.
--
-- The worker (separate later unit, /worker subdirectory) needs to flip
-- exactly one reports row from status='requested' to 'processing' per
-- claim, with FOR UPDATE SKIP LOCKED so concurrent workers never grab
-- the same row. supabase-js cannot express FOR UPDATE SKIP LOCKED
-- through PostgREST, so the claim ships as a Postgres function the
-- worker calls via supabase.rpc('claim_next_report').
--
-- SECURITY DEFINER so the function bypasses RLS on `reports` (the table
-- has NO UPDATE policy by design — see 20260525000000_create_reports.sql
-- — and the worker is the only intended mutation path).
-- search_path is pinned to public so a future schema in the runtime
-- search_path cannot intercept resolution of `reports`. Same SECURITY
-- DEFINER hygiene checklist that ADR 0011 codified for
-- current_user_role().
--
-- EXECUTE is REVOKEd from PUBLIC and granted only to service_role; the
-- application roles (authenticated, anon) must NOT be able to claim
-- worker jobs from their own session. service_role retains full
-- privileges by default — the explicit grant is there so the contract
-- is visible in the migration.

create function public.claim_next_report()
returns setof public.reports
language sql
security definer
set search_path = public
as $$
  update public.reports
     set status     = 'processing',
         updated_at = now()
   where id = (
     select id
       from public.reports
      where status = 'requested'
      order by created_at
      limit 1
      for update skip locked
   )
   returning *;
$$;

-- Default Postgres grants EXECUTE on functions to PUBLIC, and Supabase's
-- default privileges additionally grant EXECUTE on new public functions to
-- the authenticated and anon roles. Both surfaces must be revoked so the
-- function is callable only by service_role — app users (authenticated /
-- anon) must NOT be able to claim worker jobs through their own session.
revoke execute on function public.claim_next_report() from public;
revoke execute on function public.claim_next_report() from authenticated, anon;

-- service_role is the role the Railway worker authenticates as. The grant
-- is explicit (rather than relying on service_role's bypass of RLS) so the
-- access contract is visible in the migration history.
grant execute on function public.claim_next_report() to service_role;
