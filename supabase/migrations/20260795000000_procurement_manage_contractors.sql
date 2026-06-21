-- Spec 172 Phase B — procurement manages contractors (subcontractors), incl. bank.
--
-- Operator: procurement takes care of contractors, with FULL ownership incl. bank.
-- Procurement already READS contractors (spec 171 U3); this opens write + the bank
-- path, mirroring the suppliers posture (BACK_OFFICE_ROLES = pm/super/procurement/
-- director — procurement is already a supplier/equipment curator). Contractors here
-- = subcontractors (ผู้รับเหมาช่วง); DC is a worker (ADR 0062, Phase C).
--
-- RPC bodies are reproduced from the LIVE prod definition (the project_director
-- session rewrote them; sourcing the old migration file would drop director).
-- CREATE OR REPLACE keeps signatures → grants preserved. Additive + reversible.
-- project_director rides along everywhere it already did (pgTAP file 91).

-- 1. contractors INSERT — add procurement (keep created_by self-pin + director).
drop policy "contractors insert by staff" on public.contractors;
create policy "contractors insert by staff"
  on public.contractors for insert to authenticated
  with check (
    (select public.current_user_role())
      in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement')
    and created_by = (select auth.uid())
  );

-- 2. contractors UPDATE — add procurement.
drop policy "contractors update by staff" on public.contractors;
create policy "contractors update by staff"
  on public.contractors for update to authenticated
  using (
    (select public.current_user_role())
      in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement')
  )
  with check (
    (select public.current_user_role())
      in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement')
  );

-- 3. set_contact_bank — add procurement to the staff bank write gate. Body
--    reproduced verbatim from the live definition (3-target upsert), only the
--    role list changes. contact_bank stays zero-grant (read via admin client
--    behind the page gate); this is the WRITE path.
create or replace function public.set_contact_bank(
  p_contractor_id uuid default null::uuid,
  p_supplier_id uuid default null::uuid,
  p_service_provider_id uuid default null::uuid,
  p_bank_name text default null::text,
  p_bank_account_no text default null::text,
  p_bank_account_name text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_targets int := (p_contractor_id is not null)::int
                 + (p_supplier_id is not null)::int
                 + (p_service_provider_id is not null)::int;
  v_name text := nullif(btrim(p_bank_name), '');
  v_no   text := nullif(btrim(p_bank_account_no), '');
  v_acct text := nullif(btrim(p_bank_account_name), '');
  v_id uuid;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'set_contact_bank: role not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'set_contact_bank: exactly one target required' using errcode = 'P0001';
  end if;

  if p_contractor_id is not null then
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where contractor_id = p_contractor_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_contractor_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  elsif p_supplier_id is not null then
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where supplier_id = p_supplier_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (supplier_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_supplier_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  else
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where service_provider_id = p_service_provider_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (service_provider_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_service_provider_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  end if;

  return v_id;
end;
$function$;

-- 4. set_work_package_contractor — add procurement (assign a contractor to a WP).
--    Body reproduced verbatim from the live definition; only the role list changes.
create or replace function public.set_work_package_contractor(
  p_work_package_id uuid,
  p_contractor_id uuid default null::uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.current_user_role() not in
       ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'set_work_package_contractor: role not permitted'
      using errcode = '42501';
  end if;

  if p_contractor_id is not null
     and not exists (select 1 from public.contractors c where c.id = p_contractor_id) then
    return false;
  end if;

  update public.work_packages
     set contractor_id = p_contractor_id
   where id = p_work_package_id;
  return found;
end;
$function$;
