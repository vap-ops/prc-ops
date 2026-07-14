-- Spec 315 U1 — ID-card re-submit on an APPROVED registration (self-serve
-- supersede; operator decision 2026-07-14: no approval queue, the append-only
-- attachment chain keeps every prior photo).
--
-- An ID card expires; the signup flow froze all documents at approval
-- (add_staff_registration_doc refused any non-pending registration), so a
-- technician could never renew it. The gate relaxes to:
--   status = 'pending'  -> any purpose (unchanged), OR
--   status = 'approved' -> 'id_card' ONLY.
-- book_bank stays closed here on purpose — the passbook photo may only flip
-- together with an approved bank change (spec 315 U2), so the stored evidence
-- can never contradict the live workers.bank_* payout target. profile_photo on
-- an approved registration is out of scope (spec 315 §Out of scope).
--
-- Same signature => CREATE OR REPLACE preserves the ACL (no re-grant / re-revoke;
-- the 296-U1b precedent). Body sourced from the LIVE definition 2026-07-14
-- (pg_get_functiondef, verified identical to 20260813075700) — only the status
-- gate changes.

create or replace function public.add_staff_registration_doc(
  p_purpose staff_doc_purpose, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_row   public.staff_registrations%rowtype;
  v_path  text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_prior uuid;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'add_staff_registration_doc: not authenticated' using errcode = '42501';
  end if;
  if p_purpose is null then
    raise exception 'add_staff_registration_doc: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_staff_registration_doc: storage_path required' using errcode = 'P0001';
  end if;
  -- ADDED (spec 296): the path must be the caller's own folder + match the purpose,
  -- so a purpose row cannot point at a mismatched image (book_bank floor integrity).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[2] is distinct from v_uid::text
     or (storage.foldername(v_path))[3] is distinct from p_purpose::text then
    raise exception 'add_staff_registration_doc: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  select * into v_row from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'add_staff_registration_doc: no registration for this user' using errcode = 'P0001';
  end if;
  -- CHANGED (spec 315 U1): an APPROVED registration accepts an id_card renewal
  -- (self-serve supersede). All other non-pending writes stay refused.
  if v_row.status is distinct from 'pending'
     and not (v_row.status = 'approved' and p_purpose = 'id_card') then
    raise exception 'add_staff_registration_doc: registration is no longer pending' using errcode = 'P0001';
  end if;
  select a.id into v_prior
    from public.staff_registration_attachments a
   where a.registration_id = v_row.id
     and a.purpose = p_purpose
     and not exists (
       select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)
   limit 1;
  insert into public.staff_registration_attachments
    (registration_id, purpose, storage_path, uploaded_by, superseded_by)
  values (v_row.id, p_purpose, v_path, v_uid, v_prior)
  returning id into v_id;
  return v_id;
end;
$function$;
