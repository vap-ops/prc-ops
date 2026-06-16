-- Spec 130 U4 — fix-forward for 20260708000000 (pgTAP caught it against the
-- linked DB; the prior migration is applied, so correct forward).
--
-- `set status = case when p_approve then 'approved' else 'rejected' end` yields
-- TEXT, and Postgres won't implicitly cast text → contractor_change_status in
-- the UPDATE SET (42804). Cast the CASE result to the enum.

create or replace function public.decide_contractor_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.contractor_bank_change_requests%rowtype;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'decide_contractor_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.contractor_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_contractor_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_contractor_bank_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.contact_bank
       set bank_name = v_req.bank_name, bank_account_no = v_req.bank_account_no,
           bank_account_name = v_req.bank_account_name, updated_by = auth.uid(), updated_at = now()
     where contractor_id = v_req.contractor_id;
    if not found then
      insert into public.contact_bank
        (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (v_req.contractor_id, v_req.bank_name, v_req.bank_account_no,
              v_req.bank_account_name, auth.uid());
    end if;
  end if;

  update public.contractor_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
