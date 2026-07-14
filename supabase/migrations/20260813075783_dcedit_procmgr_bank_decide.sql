-- DC edit matrix (2026-07-13) — widen the decide_worker_bank_change gate to admit
-- procurement_manager. procurement_manager owns ช่าง onboarding (spec 261 / ADR 0070;
-- it is the STAFF_APPROVAL role that completes the capture-blind bank transcribe,
-- spec 298 U3), so it must also be able to approve a bound worker's portal-submitted
-- bank change. The gate was is_manager() only (project_manager/super_admin/
-- project_director) — that predated procurement_manager's onboarding ownership.
--
-- Widen to is_manager()-OR-procurement_manager (NOT is_back_office(), which would
-- also admit plain procurement — deliberately excluded: procurement is a buyer, not
-- an approver of worker money). CREATE OR REPLACE, signature unchanged → the
-- EXECUTE grant is preserved. Body re-sourced VERBATIM from LIVE (pg_get_functiondef,
-- 2026-07-13) — only the role gate changed. The status cast + inline workers.bank_*
-- apply are unchanged.
--
-- NULL-SAFE (rls-audit-2026-07 F1, pgTAP 254 T-F1a/T-F1b): the procurement_manager
-- arm is wrapped in coalesce(... , false) so a roleless principal (offboarded token,
-- current_user_role() = NULL) still fails closed — a bare `= 'procurement_manager'`
-- would evaluate to NULL and let the `if not (...)` fall through, re-opening the gate
-- the audit closed. is_manager() already coalesces internally.

create or replace function public.decide_worker_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.worker_bank_change_requests%rowtype;
begin
  if not (public.is_manager(public.current_user_role())
          or coalesce(public.current_user_role() = 'procurement_manager', false)) then
    raise exception 'decide_worker_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.worker_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_worker_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_worker_bank_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    -- Apply to the worker's own bank columns (inline — workers carry no
    -- contact_bank row; ADR 0062 U1 put bank_* on the worker).
    update public.workers
       set bank_name           = v_req.bank_name,
           bank_account_number = v_req.bank_account_number,
           bank_account_name   = v_req.bank_account_name
     where id = v_req.worker_id;
  end if;

  update public.worker_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
