-- Spec 320 U1 — worker_payout_nominee: a PM-managed, TEMPORARY payout override
-- routing a bankless worker's wage to a friend/family account, with a signed-
-- consent photo as discharge evidence. Manual, procurement_manager-only, no
-- approval flow. Append-history (new active row per nominee; clearing flips the
-- active row to cleared, never deletes) so the row provenance is its own audit
-- trail. Attribution (wage/WHT/GL) stays per-worker elsewhere; this only swaps
-- the bank destination line, read by the spec 128 disbursement builder later.
--
-- Posture: zero-grant bank PII (ADR 0079), reads via DEFINER RPCs only; gate is
-- procurement_manager ONLY (operator, not the trio). Consent photo lands in a
-- NEW PM-scoped nominee-consent/<worker_id>/ storage path (the spec 298 capture
-- path is site_admin/super_admin-scoped, so not reusable by a PM).

create table public.worker_payout_nominee (
  id                   uuid primary key default gen_random_uuid(),
  worker_id            uuid not null references public.workers(id),
  payee_name           text not null,
  payee_relationship   text not null,
  payee_bank_name      text not null,
  payee_account_number text not null,
  payee_account_name   text not null,
  consent_doc_path     text not null,
  active               boolean not null default true,
  set_by               uuid not null references public.users(id),
  set_at               timestamptz not null default now(),
  cleared_by           uuid references public.users(id),
  cleared_at           timestamptz,
  constraint wpn_payee_name_len    check (length(payee_name) <= 120),
  constraint wpn_relationship_len  check (length(payee_relationship) <= 60),
  constraint wpn_bank_name_len     check (length(payee_bank_name) <= 120),
  constraint wpn_account_no_shape  check (payee_account_number ~ '^[0-9]{6,20}$'),
  constraint wpn_account_name_len  check (length(payee_account_name) <= 120),
  constraint wpn_consent_len       check (length(consent_doc_path) <= 500),
  constraint wpn_cleared_shape     check (active = (cleared_at is null)
                                          and (cleared_at is null) = (cleared_by is null))
);
create unique index wpn_one_active_idx on public.worker_payout_nominee (worker_id)
  where active;
create index wpn_worker_idx on public.worker_payout_nominee (worker_id);

alter table public.worker_payout_nominee enable row level security;
revoke all on table public.worker_payout_nominee from anon, authenticated;
-- No authenticated policy: bank PII is DEFINER-only (ADR 0079). Reads go through
-- the RPCs below (procurement_manager) or the PM page's admin client.

-- set_worker_payout_nominee — PM only; validate; clear the prior active row;
-- insert the new active row. Returns the new row id.
create function public.set_worker_payout_nominee(
  p_worker_id            uuid,
  p_payee_name           text,
  p_payee_relationship   text,
  p_payee_bank_name      text,
  p_payee_account_number text,
  p_payee_account_name   text,
  p_consent_doc_path     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := nullif(btrim(coalesce(p_payee_name, '')), '');
  v_rel    text := nullif(btrim(coalesce(p_payee_relationship, '')), '');
  v_bank   text := nullif(btrim(coalesce(p_payee_bank_name, '')), '');
  v_no     text := nullif(regexp_replace(coalesce(p_payee_account_number, ''), '[\s-]', '', 'g'), '');
  v_holder text := nullif(btrim(coalesce(p_payee_account_name, '')), '');
  v_path   text := nullif(btrim(coalesce(p_consent_doc_path, '')), '');
  v_id     uuid;
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'set_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_worker_id) then
    raise exception 'set_worker_payout_nominee: worker not found' using errcode = 'P0001';
  end if;
  if v_name is null or v_rel is null or v_bank is null or v_no is null or v_holder is null then
    raise exception 'set_worker_payout_nominee: all payee fields required' using errcode = 'P0001';
  end if;
  if v_no !~ '^[0-9]{6,20}$' then
    raise exception 'set_worker_payout_nominee: invalid account number' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'set_worker_payout_nominee: consent photo required' using errcode = 'P0001';
  end if;
  -- Consent folder-pin: nominee-consent/<worker_id>/<file> (2 folder segments;
  -- the new PM-scoped storage policy below gates writes to this prefix).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 2
     or (storage.foldername(v_path))[1] is distinct from 'nominee-consent'
     or (storage.foldername(v_path))[2] is distinct from p_worker_id::text then
    raise exception 'set_worker_payout_nominee: consent path does not match worker/purpose'
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'contact-docs' and o.name = v_path) then
    raise exception 'set_worker_payout_nominee: consent photo not uploaded' using errcode = 'P0001';
  end if;

  -- Clear the prior active nominee (one-active invariant; index backstops the race).
  update public.worker_payout_nominee
     set active = false, cleared_by = v_uid, cleared_at = now()
   where worker_id = p_worker_id and active;

  insert into public.worker_payout_nominee
    (worker_id, payee_name, payee_relationship, payee_bank_name,
     payee_account_number, payee_account_name, consent_doc_path, set_by)
  values (p_worker_id, v_name, v_rel, v_bank, v_no, v_holder, v_path, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.set_worker_payout_nominee(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.set_worker_payout_nominee(uuid, text, text, text, text, text, text) to authenticated;

-- clear_worker_payout_nominee — PM only; flip the active row to cleared. Idempotent.
create function public.clear_worker_payout_nominee(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'clear_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  update public.worker_payout_nominee
     set active = false, cleared_by = auth.uid(), cleared_at = now()
   where worker_id = p_worker_id and active;
end;
$$;
revoke all on function public.clear_worker_payout_nominee(uuid) from public, anon;
grant execute on function public.clear_worker_payout_nominee(uuid) to authenticated;

-- get_worker_payout_nominee — PM only; the active nominee for one worker (0-or-1).
create function public.get_worker_payout_nominee(p_worker_id uuid)
returns table (
  payee_name           text,
  payee_relationship   text,
  payee_bank_name      text,
  payee_account_number text,
  payee_account_name   text,
  consent_doc_path     text,
  set_at               timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'get_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  return query
    select n.payee_name, n.payee_relationship, n.payee_bank_name, n.payee_account_number,
           n.payee_account_name, n.consent_doc_path, n.set_at
    from public.worker_payout_nominee n
    where n.worker_id = p_worker_id and n.active;
end;
$$;
revoke all on function public.get_worker_payout_nominee(uuid) from public, anon;
grant execute on function public.get_worker_payout_nominee(uuid) to authenticated;

-- list_active_payout_nominees — PM only; the soft worklist (age = days on nominee).
-- Returns worker_id only; the UI resolves name/PRC-code via the badge-codes seam.
create function public.list_active_payout_nominees()
returns table (
  worker_id            uuid,
  payee_name           text,
  payee_bank_name      text,
  payee_account_number text,
  set_at               timestamptz,
  days_active          int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'list_active_payout_nominees: role not permitted' using errcode = '42501';
  end if;
  return query
    select n.worker_id, n.payee_name, n.payee_bank_name, n.payee_account_number, n.set_at,
           (now()::date - n.set_at::date)::int as days_active
    from public.worker_payout_nominee n
    where n.active
    order by (now()::date - n.set_at::date) desc;
end;
$$;
revoke all on function public.list_active_payout_nominees() from public, anon;
grant execute on function public.list_active_payout_nominees() to authenticated;

-- Storage: new PM-scoped INSERT policy for the consent photo. The spec 298
-- capture path (sa-bank-capture/…) is site_admin/super_admin-scoped, so a PM
-- cannot reuse it. No authenticated SELECT policy matches this prefix => the
-- uploader cannot read it back; the PM surface reads via the service-role
-- signed-URL reader.
create policy "nominee-consent uploads by procurement_manager"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and (storage.foldername(name))[1] = 'nominee-consent'
    and coalesce(public.current_user_role() = 'procurement_manager', false));
