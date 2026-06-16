-- Spec 131 U1 — fix-forward for 20260709000100 (pgTAP caught it on the linked
-- DB; prior migration applied, so correct forward).
--
-- BUG: `v_is_self := current_user_contractor_id() = p_contractor` is NULL for a
-- caller with no contractor binding (NULL = x → NULL). Then
-- `if not (v_is_self or v_is_staff)` = `if not (NULL or false)` = `if NULL`,
-- which does NOT fire — so an unbound non-staff visitor BYPASSED the gate.
-- Three-valued logic. Fix: coalesce the self-check to false.

create or replace function public.record_contractor_consent(
  p_contractor  uuid,
  p_kind        public.contractor_consent_kind,
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_is_self  boolean := coalesce(public.current_user_contractor_id() = p_contractor, false);
  v_is_staff boolean := public.current_user_role() in ('site_admin', 'project_manager', 'super_admin');
begin
  if not (v_is_self or v_is_staff) then
    raise exception 'record_contractor_consent: not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor) then
    raise exception 'record_contractor_consent: contractor not found' using errcode = 'P0001';
  end if;
  insert into public.contractor_consents (contractor_id, kind, recorded_by, document_id)
  values (p_contractor, p_kind, auth.uid(), p_document_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revoke_contractor_consent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.contractor_consents%rowtype;
  v_is_self  boolean;
  v_is_staff boolean := public.current_user_role() in ('project_manager', 'super_admin');
begin
  select * into v_req from public.contractor_consents where id = p_id for update;
  if not found then
    raise exception 'revoke_contractor_consent: not found' using errcode = 'P0001';
  end if;
  v_is_self := coalesce(public.current_user_contractor_id() = v_req.contractor_id, false);
  if not (v_is_self or v_is_staff) then
    raise exception 'revoke_contractor_consent: not permitted' using errcode = '42501';
  end if;
  update public.contractor_consents set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;
