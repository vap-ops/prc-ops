-- Spec 298 U1 — SA-assisted onboarding: capture-blind bank for phoneless workers.
-- Walled capture store policy + worker_bank_capture (zero-grant) + status enum +
-- DEFINER RPCs: add-with-capture (SA), status projection (SA), PM-complete (money set).

-- 1. Status enum.
create type public.worker_bank_capture_status as enum ('pending_pm', 'on_file');

-- 2. Zero-grant capture table (mirror the staff_registration_bank wall).
create table public.worker_bank_capture (
  worker_id     uuid primary key references public.workers(id) on delete cascade,
  photo_path    text not null,
  status        public.worker_bank_capture_status not null default 'pending_pm',
  captured_by   uuid not null,
  captured_at   timestamptz not null default now(),
  completed_by  uuid,
  completed_at  timestamptz
);
alter table public.worker_bank_capture enable row level security;
revoke all on public.worker_bank_capture from anon, authenticated;
grant select, insert, update, delete on public.worker_bank_capture to service_role;
-- No authenticated policy => deny by default. SA status reads go through the DEFINER
-- projection (sa_worker_bank_status); PM reads via the service-role admin client (U3).

-- 3. Walled Storage policy: site_admin/super may INSERT into sa-bank-capture/…; NO authenticated
--    SELECT policy matches that folder => unreadable to the uploader. (Verified LIVE 2026-07-12:
--    the only contact-docs SELECT policies match foldername[1] in {contractor, technician}.)
create policy "sa bank-capture uploads by site_admin" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and (storage.foldername(name))[1] = 'sa-bank-capture'
    and public.current_user_role() in ('site_admin','super_admin'));

-- 4. Add-with-capture (SA path). Models sa_add_project_worker (spec279u4) + the capture insert, atomic.
create function public.sa_add_project_worker_with_bank(
  p_project uuid, p_name text, p_national_id text, p_dob date, p_photo_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_yy     int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq    int;
  v_emp    text;
  v_worker uuid;
begin
  if v_role is null or v_role not in ('site_admin','super_admin') then
    raise exception 'sa_add_project_worker_with_bank: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_add_project_worker_with_bank: not a member of this project' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'sa_add_project_worker_with_bank: name required' using errcode = 'P0001';
  end if;
  if not public.is_valid_thai_national_id(p_national_id) then
    raise exception 'sa_add_project_worker_with_bank: invalid Thai national-ID' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
    raise exception 'sa_add_project_worker_with_bank: worker must be at least 18' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_photo_path), '') = ''
     or split_part(p_photo_path, '/', 1) is distinct from 'sa-bank-capture' then
    raise exception 'sa_add_project_worker_with_bank: a passbook photo is required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = p_national_id) then
    raise exception 'sa_add_project_worker_with_bank: this national-ID is already on a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crew_registrations r where r.national_id = p_national_id and r.status = 'pending') then
    raise exception 'sa_add_project_worker_with_bank: this national-ID is already a pending registration' using errcode = 'P0001';
  end if;

  insert into public.employee_id_counters (year, next_val) values (v_yy, 2)
  on conflict (year) do update set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;
  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, tax_id, date_of_birth)
  values (v_name, 'daily', 'temporary', null, v_emp, 0,
          true, auth.uid(), p_project, p_national_id, p_dob)
  returning id into v_worker;

  insert into public.worker_bank_capture (worker_id, photo_path, status, captured_by)
  values (v_worker, p_photo_path, 'pending_pm', auth.uid());

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, p_project, auth.uid(), 'sa direct add (capture-blind bank)');

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', v_worker,
          jsonb_build_object('kind','create','source','sa_add_with_bank','project_id',p_project,'employee_id',v_emp));
  return v_worker;
end; $$;
revoke all on function public.sa_add_project_worker_with_bank(uuid, text, text, date, text) from public;
revoke execute on function public.sa_add_project_worker_with_bank(uuid, text, text, date, text) from anon;
grant execute on function public.sa_add_project_worker_with_bank(uuid, text, text, date, text) to authenticated;

-- 5. Status projection (SA roster chip) — status only, no photo_path.
create function public.sa_worker_bank_status(p_project uuid)
returns table(worker_id uuid, status public.worker_bank_capture_status)
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('site_admin','super_admin') then
    raise exception 'sa_worker_bank_status: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_worker_bank_status: not a member of this project' using errcode = '42501';
  end if;
  return query
    select c.worker_id, c.status
    from public.worker_bank_capture c
    join public.workers w on w.id = c.worker_id
    where w.project_id = p_project;
end; $$;
revoke all on function public.sa_worker_bank_status(uuid) from public;
revoke execute on function public.sa_worker_bank_status(uuid) from anon;
grant execute on function public.sa_worker_bank_status(uuid) to authenticated;

-- 6. PM completion (money set) — transcribe photo -> workers.bank_*; flip status. Never touches pay/level.
create function public.complete_worker_bank(
  p_worker_id uuid, p_bank_name text, p_account_number text, p_account_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role      public.user_role := public.current_user_role();
  v_name      text := btrim(coalesce(p_bank_name, ''));
  v_acct_name text := btrim(coalesce(p_account_name, ''));
  v_acct      text := regexp_replace(coalesce(p_account_number, ''), '[[:space:]-]', '', 'g');
  v_cap       public.worker_bank_capture%rowtype;
begin
  if v_role is null or v_role not in ('procurement_manager','project_director','super_admin') then
    raise exception 'complete_worker_bank: role not permitted' using errcode = '42501';
  end if;
  select * into v_cap from public.worker_bank_capture where worker_id = p_worker_id;
  if not found or v_cap.status is distinct from 'pending_pm' then
    raise exception 'complete_worker_bank: no pending bank capture for this worker' using errcode = 'P0001';
  end if;
  if v_name = '' or v_acct_name = '' or v_acct = '' then
    raise exception 'complete_worker_bank: bank name, account number and account name are required' using errcode = 'P0001';
  end if;
  if v_acct !~ '^[0-9]{6,20}$' then
    raise exception 'complete_worker_bank: account number must be 6-20 digits' using errcode = 'P0001';
  end if;
  update public.workers
     set bank_name = v_name, bank_account_number = v_acct, bank_account_name = v_acct_name
   where id = p_worker_id;
  update public.worker_bank_capture
     set status = 'on_file', completed_by = auth.uid(), completed_at = now()
   where worker_id = p_worker_id;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', p_worker_id,
          jsonb_build_object('kind','bank_set','source','sa_capture_pm_complete'));
end; $$;
revoke all on function public.complete_worker_bank(uuid, text, text, text) from public;
revoke execute on function public.complete_worker_bank(uuid, text, text, text) from anon;
grant execute on function public.complete_worker_bank(uuid, text, text, text) to authenticated;
