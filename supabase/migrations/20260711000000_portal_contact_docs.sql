-- Spec 131 U2c / ADR 0051 — external-write storage RLS so a bound DC uploads and
-- reads their OWN contact documents from /portal, scoped to their own contractor
-- path. ADDITIVE to the spec-97 PM policies; the internal posture is untouched (a
-- staff / NULL-contractor session matches neither external predicate, so it adds
-- zero rows and keeps reading via the service-role admin client).
--
-- Defense in depth — three independent gates, each proven in pgTAP file 53:
--   1. storage.objects WITH CHECK / USING — the path's contractor-id segment must
--      equal current_user_contractor_id() (NULL-safe: NULL ≠ any id → denied).
--   2. add_contact_document — widened with a coalesce(self, false) own-contractor
--      branch (the spec-131-U1 three-valued-logic lesson: an unbound caller's
--      `helper() = x` is NULL, so coalesce-to-false or the gate silently opens).
--   3. contact_attachments — gains an own-contractor SELECT policy so the DC can
--      list their own docs and mint signed URLs on the RLS session — NEVER the
--      admin client (ADR 0051 §5).
-- Every nullable-identity helper call is wrapped (select …) for the RLS eval-once
-- optimisation (the file-40 guard / the spec-130-U1 fix-forward lesson).

-- ----------------------------------------------------------------------------
-- 1. storage.objects — external INSERT + SELECT on the contact-docs bucket, own
-- path only. Path: contractor/{contractorId}/{attachmentId}.{ext} → foldername =
-- [contractor, contractorId]. objects.name is qualified (the spec-97
-- name-capture hazard: an unqualified `name` resolves against another table).
-- ----------------------------------------------------------------------------
create policy "contact doc uploads by bound contractor"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[1] = 'contractor'
    and (storage.foldername(objects.name))[2] = (select public.current_user_contractor_id()::text)
  );

create policy "contact doc reads by bound contractor"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[1] = 'contractor'
    and (storage.foldername(objects.name))[2] = (select public.current_user_contractor_id()::text)
  );

-- ----------------------------------------------------------------------------
-- 2. contact_attachments — own-contractor SELECT (additive). Internal staff keep
-- reading via the service-role admin client (RLS-bypass behind requireRole), so
-- this policy only ever adds the bound DC's own rows. Direct INSERT stays
-- RPC-only (no insert grant — the RPC is the single writer).
-- ----------------------------------------------------------------------------
grant select on public.contact_attachments to authenticated;
create policy "contact_attachments readable by bound contractor"
  on public.contact_attachments for select to authenticated
  using (contractor_id = (select public.current_user_contractor_id()));

-- ----------------------------------------------------------------------------
-- 3. add_contact_document — widen to admit a bound DC writing their OWN doc.
-- Staff (pm/super) path unchanged. The own-doc branch is coalesce(…, false) so an
-- unbound caller (NULL helper) is DENIED, not let through by 3-valued logic; only
-- a contractor target (no supplier/service-provider) is self-writable. The caller
-- never supplies the storage path raw — the server action rebuilds it from the
-- server-read contractor id before this RPC.
-- ----------------------------------------------------------------------------
create or replace function public.add_contact_document(
  p_contractor_id       uuid default null,
  p_supplier_id         uuid default null,
  p_service_provider_id uuid default null,
  p_purpose             public.contact_doc_purpose default null,
  p_storage_path        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_targets int := (p_contractor_id is not null)::int
                 + (p_supplier_id is not null)::int
                 + (p_service_provider_id is not null)::int;
  v_path text := nullif(btrim(p_storage_path), '');
  v_self uuid := public.current_user_contractor_id();
  v_is_staff boolean := public.current_user_role() in ('project_manager', 'super_admin');
  v_is_self_doc boolean := coalesce(
    v_self is not null
    and p_contractor_id = v_self
    and p_supplier_id is null
    and p_service_provider_id is null,
    false);
  v_id uuid;
begin
  if not (v_is_staff or v_is_self_doc) then
    raise exception 'add_contact_document: not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'add_contact_document: exactly one target required' using errcode = 'P0001';
  end if;
  if p_purpose is null then
    raise exception 'add_contact_document: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_contact_document: storage_path required' using errcode = 'P0001';
  end if;

  insert into public.contact_attachments
    (contractor_id, supplier_id, service_provider_id, purpose, storage_path, uploaded_by)
  values
    (p_contractor_id, p_supplier_id, p_service_provider_id, p_purpose, v_path, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
-- grants carry over (create or replace preserves them; authenticated already holds
-- execute — the spec-97 grant + the spec-131-U1 fix-forward precedent).

-- ----------------------------------------------------------------------------
-- 4. my_contact_bank_present() — boolean: does the caller's OWN contractor have a
-- bank on file? PRESENCE ONLY (no account number leaves the DB) so the portal
-- completeness checklist can reuse contractorPacketStatus without granting the
-- zero-grant contact_bank table to the DC (the get_my_dc_payments precedent).
-- NULL-contractor (internal / unbound session) → false.
-- ----------------------------------------------------------------------------
create function public.my_contact_bank_present()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contact_bank b
    where public.current_user_contractor_id() is not null
      and b.contractor_id = public.current_user_contractor_id()
      and nullif(btrim(b.bank_account_no), '') is not null
  );
$$;
revoke all on function public.my_contact_bank_present() from public, anon;
grant execute on function public.my_contact_bank_present() to authenticated;
