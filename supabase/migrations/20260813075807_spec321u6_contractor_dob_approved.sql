-- Spec 321 U6 — a contractor's DOB joins the APPROVED identity tier (operator
-- decision 2026-07-16: sensitive fields — name / national ID / DOB — are approved
-- tier for EVERY role; for contractors the personal field is DOB only, since a
-- contractors row's name/tax_id are PARTY fields managed on /contacts).
--
-- Spec 317 U3 deliberately left contractors out of decide_identity_change (a
-- contractors row is a firm/crew party, not personal identity). U6 adds ONE arm:
-- on approve, a proposed DOB is also written to public.contractors.date_of_birth
-- for the login's bound contractor — resolved via the same contractor_users
-- binding current_user_contractor_id() uses. A login with no binding matches no
-- rows (the arm is a safe no-op). Name/national-ID arms are unchanged: a
-- contractor has no workers row, so those already no-op for them; their users
-- full_name still applies (personal login name), which is correct.
--
-- And the instant self-edit path loses DOB: update_own_emergency_contact drops
-- from 4 args to 3 (emergency name/relation/phone only). DOB now routes through
-- the approval flow, so the portal's instant วันเกิด input is retired (spec 321
-- decision 2: no instant DOB for any role).

-- ---------------------------------------------------------------------------
-- decide_identity_change — sourced VERBATIM from the live definition (spec 317
-- U3), plus the new contractors DOB arm inside the approve branch.
-- ---------------------------------------------------------------------------
create or replace function public.decide_identity_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.identity_change_requests%rowtype;
begin
  if coalesce(public.current_user_role()
                in ('procurement_manager', 'project_director', 'super_admin'), false) is not true then
    raise exception 'decide_identity_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.identity_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_identity_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_identity_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.users
       set full_name = coalesce(v_req.proposed_full_name, full_name)
     where id = v_req.user_id;

    update public.workers
       set name          = coalesce(v_req.proposed_full_name, name),
           tax_id        = coalesce(v_req.proposed_national_id, tax_id),
           date_of_birth = coalesce(v_req.proposed_dob, date_of_birth)
     where user_id = v_req.user_id;

    update public.staff_registrations
       set full_name     = coalesce(v_req.proposed_full_name, full_name),
           date_of_birth = coalesce(v_req.proposed_dob, date_of_birth),
           updated_at    = now()
     where user_id = v_req.user_id
       and status = 'approved';

    -- Spec 321 U6 — a bound contractor's DOB is personal identity. `in` (not a
    -- scalar subquery) so a login with 0 bindings is a no-op and never errors.
    update public.contractors
       set date_of_birth = coalesce(v_req.proposed_dob, date_of_birth)
     where id in (select cu.contractor_id
                    from public.contractor_users cu
                   where cu.user_id = v_req.user_id);
  end if;

  update public.identity_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_identity_change(uuid, boolean) from public, anon;
grant execute on function public.decide_identity_change(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- update_own_emergency_contact — drop the 4-arg overload (which wrote DOB) and
-- recreate it without DOB. Emergency contact stays instant (not money); DOB is
-- now approval-gated. Body otherwise unchanged (spec 131 U2b): column-scoped to
-- the three emergency columns for the caller's own contractor.
-- ---------------------------------------------------------------------------
drop function if exists public.update_own_emergency_contact(text, text, text, date);

create function public.update_own_emergency_contact(
  p_name     text,
  p_relation text,
  p_phone    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor uuid := public.current_user_contractor_id();
begin
  if v_contractor is null then
    raise exception 'update_own_emergency_contact: caller is not a bound contractor'
      using errcode = '42501';
  end if;
  update public.contractors
     set emergency_contact_name     = nullif(btrim(p_name), ''),
         emergency_contact_relation = nullif(btrim(p_relation), ''),
         emergency_contact_phone    = nullif(btrim(p_phone), '')
   where id = v_contractor;
end;
$$;
revoke all on function public.update_own_emergency_contact(text, text, text) from public, anon;
grant execute on function public.update_own_emergency_contact(text, text, text) to authenticated;
