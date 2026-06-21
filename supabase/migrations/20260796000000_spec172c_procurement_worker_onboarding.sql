-- Spec 172 Phase C / ADR 0062 — procurement onboards DC workers (incl. pay rate).
--
-- The operator gave procurement FULL DC-onboarding ownership: create/update/assign
-- workers, issue portal invites, and SET the pay rate. This admits 'procurement'
-- to the role gate of each worker-onboarding RPC, leaving every other line of the
-- body verbatim. Each body was sourced from the LIVE prod DB (pg_get_functiondef)
-- at migration time — the concurrent spec-170 session had been editing these — so
-- this reproduces the current bodies, not an old migration's.
--
-- Mechanism: CREATE OR REPLACE with UNCHANGED signatures, so the EXECUTE grants
-- (authenticated-only lockdown, pgTAP 36) are preserved — NOT a DROP+CREATE, which
-- would reset EXECUTE to the PUBLIC default. project_director rides along in every
-- list (file 91 doctrine). Bank/tax/phone/day_rate continue to be written through
-- these SECURITY DEFINER bodies (the zero column-grant is bypassed by the definer);
-- the READ path stays admin-only — this opens onboarding, not PII exposure.

-- 1. create_worker — add 'procurement'.
create or replace function public.create_worker(p_name text, p_type worker_type, p_day_rate numeric, p_contractor uuid default null::uuid, p_user uuid default null::uuid, p_note text default null::text, p_arrangement dc_arrangement default null::dc_arrangement, p_phone text default null::text, p_tax_id text default null::text, p_bank_name text default null::text, p_bank_account_number text default null::text, p_bank_account_name text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;
  if p_arrangement is not null and p_type <> 'dc' then
    raise exception 'create_worker: arrangement only applies to dc workers'
      using errcode = 'P0001';
  end if;

  insert into public.workers (name, worker_type, contractor_id, user_id,
                              day_rate, created_by, note, dc_arrangement,
                              phone, tax_id, bank_name, bank_account_number,
                              bank_account_name)
  values (v_name, p_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''), p_arrangement,
          nullif(btrim(p_phone), ''), nullif(btrim(p_tax_id), ''),
          nullif(btrim(p_bank_name), ''), nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''))
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'worker_type', p_type,
                                   'day_rate', p_day_rate,
                                   'dc_arrangement', p_arrangement));
  return v_id;
end;
$function$;

-- 2. update_worker — add 'procurement'.
create or replace function public.update_worker(p_id uuid, p_name text default null::text, p_active boolean default null::boolean, p_contractor uuid default null::uuid, p_note text default null::text, p_arrangement dc_arrangement default null::dc_arrangement, p_phone text default null::text, p_tax_id text default null::text, p_bank_name text default null::text, p_bank_account_number text default null::text, p_bank_account_name text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_contractor is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: contractor only applies to dc workers'
      using errcode = 'P0001';
  end if;
  if p_arrangement is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: arrangement only applies to dc workers'
      using errcode = 'P0001';
  end if;

  -- Coalesce semantics (record_purchase precedent): omitted = preserved.
  -- The note uses case-preserve so an explicit '' can clear it; the payee
  -- text fields coalesce (edit replaces, omit preserves).
  update public.workers
     set name                = coalesce(v_name, name),
         active              = coalesce(p_active, active),
         contractor_id       = coalesce(p_contractor, contractor_id),
         dc_arrangement      = coalesce(p_arrangement, dc_arrangement),
         phone               = coalesce(nullif(btrim(p_phone), ''), phone),
         tax_id              = coalesce(nullif(btrim(p_tax_id), ''), tax_id),
         bank_name           = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
         bank_account_number = coalesce(nullif(btrim(p_bank_account_number), ''), bank_account_number),
         bank_account_name   = coalesce(nullif(btrim(p_bank_account_name), ''), bank_account_name),
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
                                   'contractor_id', p_contractor,
                                   'dc_arrangement', p_arrangement));
end;
$function$;

-- 3. assign_worker_to_project — add 'procurement'.
create or replace function public.assign_worker_to_project(p_worker uuid, p_project uuid default null::uuid, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_exists boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if public.current_user_role()
       not in ('project_manager', 'project_director', 'super_admin', 'procurement') then
    raise exception 'assign_worker_to_project: role not permitted' using errcode = '42501';
  end if;
  select true into v_exists from public.workers where id = p_worker;
  if not found then
    raise exception 'assign_worker_to_project: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set project_id = p_project where id = p_worker;

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (p_worker, p_project, auth.uid(), v_reason);

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_worker, jsonb_build_object('kind', 'project_move',
                                       'project_id', p_project,
                                       'reason', v_reason));
end;
$function$;

-- 4. create_worker_invite — add 'procurement'.
create or replace function public.create_worker_invite(p_worker uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_token text;
  v_type  public.worker_type;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'create_worker_invite: role not permitted' using errcode = '42501';
  end if;
  select worker_type into v_type from public.workers where id = p_worker;
  if not found then
    raise exception 'create_worker_invite: worker not found' using errcode = 'P0001';
  end if;
  if v_type <> 'dc' then
    raise exception 'create_worker_invite: portal invites are for dc workers' using errcode = 'P0001';
  end if;
  -- 64-char hex token (gen_random_uuid is guaranteed present; gen_random_bytes is not).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token, created_by, expires_at)
  values (p_worker, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

-- 5. set_worker_day_rate — add 'procurement' (operator: procurement SETS the rate).
create or replace function public.set_worker_day_rate(p_id uuid, p_rate numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old numeric;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'set_worker_day_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_worker_day_rate: invalid rate' using errcode = 'P0001';
  end if;
  select day_rate into v_old from public.workers where id = p_id;
  if not found then
    raise exception 'set_worker_day_rate: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set day_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'rate_change',
                                   'old_rate', v_old, 'new_rate', p_rate));
end;
$function$;
