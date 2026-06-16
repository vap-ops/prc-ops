-- Spec 130 U2 / ADR 0051 — row-level RLS for the external contractor tier.
--
-- DUAL-POLICY: the internal role-level policies (ADR 0013) stay; each
-- DC-reachable table gains an ADDITIVE permissive SELECT policy scoped to the
-- caller's bound contractor via current_user_contractor_id(). For an internal
-- session that helper is NULL, so the external policy adds zero rows — internal
-- access is unchanged. Every helper call is wrapped (select …) for the RLS
-- eval-once optimization (file-40 guard; the U1 fix-forward lesson).
--
-- MONEY POSTURE PRESERVED. contractors/workers/labor_logs already protect money
-- by COLUMN grant (day_rate / day_rate_snapshot have no authenticated grant), so
-- a DC reading their own rows still cannot read those columns. dc_payments is
-- FULLY zero-grant (file 35); rather than grant the table (which would break
-- that posture and leak to internal sessions), a DC reads their own payments
-- through a SECURITY DEFINER reader scoped to their contractor.

-- contractors — own row (profile). All columns here are non-money (bank lives in
-- contact_bank, a separate zero-grant table handled in U4).
create policy "contractors readable by bound contractor"
  on public.contractors for select to authenticated
  using (id = (select public.current_user_contractor_id()));

-- workers — own crew. day_rate stays column-grant-blocked for authenticated.
create policy "workers readable by bound contractor"
  on public.workers for select to authenticated
  using (contractor_id = (select public.current_user_contractor_id()));

-- labor_logs — own DC days. day_rate_snapshot stays column-grant-blocked.
create policy "labor_logs readable by bound contractor"
  on public.labor_logs for select to authenticated
  using (
    worker_type_snapshot = 'dc'
    and contractor_id_snapshot = (select public.current_user_contractor_id())
  );

-- ----------------------------------------------------------------------------
-- get_my_dc_payments() — a DC reads their OWN payments (incl. amounts) without
-- granting the zero-grant dc_payments table to authenticated. SECURITY DEFINER
-- + a hard contractor filter: an internal session (NULL contractor) gets zero
-- rows. Current-state only (supersede anti-join). The PM cost/payroll surfaces
-- keep reading dc_payments via the admin client — untouched.
-- ----------------------------------------------------------------------------
create function public.get_my_dc_payments()
returns setof public.dc_payments
language sql
stable
security definer
set search_path = public
as $$
  select d.*
  from public.dc_payments d
  where public.current_user_contractor_id() is not null
    and d.contractor_id = public.current_user_contractor_id()
    and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id);
$$;
revoke all on function public.get_my_dc_payments() from public, anon;
grant execute on function public.get_my_dc_payments() to authenticated;
