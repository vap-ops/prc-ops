-- Spec 170 U4c-2 fix-forward — decide_worker_bank_change raised 42804 on every
-- decision: `case when p_approve then 'approved' else 'rejected' end` yields TEXT
-- (a CASE result is text, not an `unknown` literal), and there is no implicit
-- text→enum cast, so the status UPDATE failed. The shipped contractor decide RPC
-- already carries the explicit `::public.contractor_change_status` cast (it was
-- fixed the same way in 20260708000100) — the new worker RPC was copied from the
-- uncast base. CREATE OR REPLACE (signature unchanged → EXECUTE grant preserved);
-- only the status assignment is corrected.

create or replace function public.decide_worker_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.worker_bank_change_requests%rowtype;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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
