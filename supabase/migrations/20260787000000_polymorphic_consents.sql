-- Spec 170 / ADR 0062 U4b-2 — polymorphic consents.
--
-- A DC is a worker, so PDPA / background-check consent must attach to a worker,
-- not only a contractor party. Operator chose the POLYMORPHIC option (one table
-- serves both): contractor_consents gains worker_id, contractor_id becomes
-- nullable, and a CHECK enforces exactly one party (XOR). The contractor path
-- (record_contractor_consent / 51-contractor-onboarding) is unchanged — it still
-- writes contractor_id with worker_id null.

alter table public.contractor_consents
  add column worker_id uuid null references public.workers(id),
  alter column contractor_id drop not null,
  add constraint contractor_consents_party_xor
    check (num_nonnulls(contractor_id, worker_id) = 1);
create index contractor_consents_worker_idx on public.contractor_consents (worker_id, kind);

-- The bound WORKER reads their own consents (additive arm; the contractor +
-- staff arms stay). Eval-once-wrapped (file-40 doctrine).
create policy "contractor_consents readable by bound worker"
  on public.contractor_consents for select to authenticated
  using (worker_id = (select public.current_user_worker_id()));

-- ----------------------------------------------------------------------------
-- record_worker_consent — the bound DC worker records their OWN consent from the
-- portal. Self-scoped to current_user_worker_id() (coalesced to false for an
-- unbound caller — the spec-131 three-valued-logic lesson). Returns the id.
-- ----------------------------------------------------------------------------
create function public.record_worker_consent(
  p_kind        public.contractor_consent_kind,
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_worker uuid := public.current_user_worker_id();
begin
  if v_worker is null then
    raise exception 'record_worker_consent: caller is not a bound worker' using errcode = '42501';
  end if;
  insert into public.contractor_consents (worker_id, kind, recorded_by, document_id)
  values (v_worker, p_kind, auth.uid(), p_document_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_worker_consent(public.contractor_consent_kind, uuid)
  from public, anon;
grant execute on function public.record_worker_consent(public.contractor_consent_kind, uuid)
  to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_contractor_consent — generalize the self-check so the bound WORKER may
-- revoke their own worker consent too (PDPA withdrawal). Signature unchanged →
-- the spec-131 grant is preserved; the contractor + staff paths are untouched.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_contractor_consent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      public.contractor_consents%rowtype;
  v_is_self  boolean;
  v_is_staff boolean := public.current_user_role() in ('project_manager', 'super_admin');
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
