-- Spec 170 U4b-2 — fix-forward for 20260787000000 (pgTAP file 90 caught it; prior
-- migration applied, so correct forward).
--
-- BUG: 20260787's CREATE OR REPLACE of revoke_contractor_consent reproduced the
-- ORIGINAL (20260709) body, whose v_is_staff gate is ('project_manager',
-- 'super_admin') — dropping the project_director arm that spec 152 (mig 20260751)
-- had added to every PM-gated RPC. The "no PM-gated RPC is left without
-- project_director" guard failed. (The recurring lesson: reconstruct an RPC body
-- from the LIVE definition, never hand-copy an old migration.) Re-add the
-- director arm while keeping the U4b-2 worker self-revoke branch.

create or replace function public.revoke_contractor_consent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      public.contractor_consents%rowtype;
  v_is_self  boolean;
  v_is_staff boolean := public.current_user_role()
    in ('project_manager', 'super_admin', 'project_director');
begin
  select * into v_req from public.contractor_consents where id = p_id for update;
  if not found then
    raise exception 'revoke_contractor_consent: not found' using errcode = 'P0001';
  end if;
  v_is_self := coalesce(public.current_user_contractor_id() = v_req.contractor_id, false)
            or coalesce(public.current_user_worker_id() = v_req.worker_id, false);
  if not (v_is_self or v_is_staff) then
    raise exception 'revoke_contractor_consent: not permitted' using errcode = '42501';
  end if;
  update public.contractor_consents set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;
