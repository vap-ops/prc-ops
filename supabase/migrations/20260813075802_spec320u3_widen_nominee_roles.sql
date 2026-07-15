-- Spec 320 U3 — widen the payout-nominee management gate. Operator (2026-07-15,
-- "enable procurement manager to do as well"): in addition to procurement_manager,
-- allow project_director + super_admin + plain procurement to manage nominees.
-- CREATE OR REPLACE the 4 DEFINER RPCs (bodies unchanged except the gate) + swap
-- the nominee-consent storage INSERT policy to the same role set. Still coalesce-
-- to-false so a NULL/unbound role fails CLOSED. No table/data change.

create or replace function public.set_worker_payout_nominee(
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
  if coalesce(public.current_user_role()
       in ('procurement_manager', 'project_director', 'super_admin', 'procurement'), false) is not true then
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

create or replace function public.clear_worker_payout_nominee(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role()
       in ('procurement_manager', 'project_director', 'super_admin', 'procurement'), false) is not true then
    raise exception 'clear_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  update public.worker_payout_nominee
     set active = false, cleared_by = auth.uid(), cleared_at = now()
   where worker_id = p_worker_id and active;
end;
$$;

create or replace function public.get_worker_payout_nominee(p_worker_id uuid)
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
  if coalesce(public.current_user_role()
       in ('procurement_manager', 'project_director', 'super_admin', 'procurement'), false) is not true then
    raise exception 'get_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  return query
    select n.payee_name, n.payee_relationship, n.payee_bank_name, n.payee_account_number,
           n.payee_account_name, n.consent_doc_path, n.set_at
    from public.worker_payout_nominee n
    where n.worker_id = p_worker_id and n.active;
end;
$$;

create or replace function public.list_active_payout_nominees()
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
  if coalesce(public.current_user_role()
       in ('procurement_manager', 'project_director', 'super_admin', 'procurement'), false) is not true then
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

-- Storage: widen the consent INSERT policy to the same role set (drop the
-- PM-only policy, recreate under a role-neutral name).
drop policy if exists "nominee-consent uploads by procurement_manager" on storage.objects;
create policy "nominee-consent uploads by procurement roles"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and (storage.foldername(name))[1] = 'nominee-consent'
    and coalesce(public.current_user_role()
          in ('procurement_manager', 'project_director', 'super_admin', 'procurement'), false));
