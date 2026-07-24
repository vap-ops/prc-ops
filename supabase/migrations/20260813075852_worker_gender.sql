-- Spec 357 U-F — workers.gender: enum + nullable column + a one-column widen of
-- the workers PII column wall + p_gender on the two worker-write RPCs.
--
-- The wall (spec 306 U1): workers has NO table-level authenticated grant;
-- authenticated reads a named-column subset via column grants. gender joins
-- that subset (same exposure class as name/level — low-sensitivity, needed for
-- the muster cockpit's at-a-glance ช/ญ). The row wall (SELECT policy) is
-- untouched. anon gets nothing.
--
-- create_worker / update_worker gain a TRAILING `p_gender ... default null`.
-- Adding a parameter changes the signature — CREATE OR REPLACE with the new
-- arg list would create an OVERLOAD (PostgREST rpc ambiguity), so the old
-- 12-arg functions are DROPPED first and grants re-applied on the new ones.
-- Bodies are grafted from the LIVE definitions (2026-07-24, db head 075851),
-- never from old migration files. update: gender = coalesce(p_gender, gender)
-- — omitted keeps, same as every other update_worker field.

create type public.worker_gender as enum ('male', 'female');

alter table public.workers add column gender public.worker_gender;

grant select (gender) on public.workers to authenticated;

-- ---------------------------------------------------------------------------
-- create_worker: 12-arg → 13-arg (p_gender appended).
-- ---------------------------------------------------------------------------
drop function public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text);

create function public.create_worker(
  p_name text,
  p_pay_type public.pay_type,
  p_employment_type public.employment_type,
  p_day_rate numeric default 0,
  p_contractor uuid default null,
  p_user uuid default null,
  p_note text default null,
  p_phone text default null,
  p_tax_id text default null,
  p_bank_name text default null,
  p_bank_account_number text default null,
  p_bank_account_name text default null,
  p_gender public.worker_gender default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;

  insert into public.workers (name, pay_type, employment_type, contractor_id, user_id,
                              day_rate, created_by, note,
                              phone, tax_id, bank_name, bank_account_number,
                              bank_account_name, gender)
  values (v_name, p_pay_type, p_employment_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''),
          nullif(btrim(p_phone), ''), nullif(btrim(p_tax_id), ''),
          nullif(btrim(p_bank_name), ''), nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''), p_gender)
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'pay_type', p_pay_type,
                                   'day_rate', p_day_rate,
                                   'employment_type', p_employment_type,
                                   'gender', p_gender));
  return v_id;
end;
$function$;

revoke all on function public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text, public.worker_gender) from public, anon;
grant execute on function public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text, public.worker_gender) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- update_worker: 12-arg → 13-arg (p_gender appended; coalesce-keep).
-- ---------------------------------------------------------------------------
drop function public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text);

create function public.update_worker(
  p_id uuid,
  p_name text default null,
  p_active boolean default null,
  p_pay_type public.pay_type default null,
  p_employment_type public.employment_type default null,
  p_contractor uuid default null,
  p_note text default null,
  p_phone text default null,
  p_tax_id text default null,
  p_bank_name text default null,
  p_bank_account_number text default null,
  p_bank_account_name text default null,
  p_gender public.worker_gender default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;

  -- Coalesce semantics: omitted = preserved. Note case-preserves so an explicit
  -- '' can clear it; payee text fields coalesce (edit replaces, omit preserves).
  update public.workers
     set name                = coalesce(v_name, name),
         active              = coalesce(p_active, active),
         pay_type            = coalesce(p_pay_type, pay_type),
         employment_type     = coalesce(p_employment_type, employment_type),
         contractor_id       = coalesce(p_contractor, contractor_id),
         phone               = coalesce(nullif(btrim(p_phone), ''), phone),
         tax_id              = coalesce(nullif(btrim(p_tax_id), ''), tax_id),
         bank_name           = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
         bank_account_number = coalesce(nullif(btrim(p_bank_account_number), ''), bank_account_number),
         bank_account_name   = coalesce(nullif(btrim(p_bank_account_name), ''), bank_account_name),
         gender              = coalesce(p_gender, gender),
         note                = case
                                 when p_note is null then note
                                 else nullif(btrim(p_note), '')
                               end
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'pay_type', p_pay_type,
                                   'employment_type', p_employment_type,
                                   'gender', p_gender));
end;
$function$;

revoke all on function public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text, public.worker_gender) from public, anon;
grant execute on function public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text, public.worker_gender) to authenticated, service_role;
