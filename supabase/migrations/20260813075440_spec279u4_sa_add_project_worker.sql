-- ============================================================================
-- Spec 279 U4 / ADR 0079 — direct SA-add of a phoneless worker.
--
-- The crew-lead / staging path (U2) needs a crew + a lead; a live site_admin with
-- no crew had no reachable way to add his phoneless ช่าง (the app then blocked him
-- on แผน/attendance). This is the operator-chosen "direct" unblock (option A): an
-- SA adds a worker straight onto their OWN project. The SA sets NO money — the
-- worker is active + rostered but day_rate 0 / level null / cost_confirmed_at null,
-- so it stays OUT of the cost engine until a PM confirms (set_worker_day_rate +
-- confirm_worker_cost). Reuses the U2 checksum + PRC-YY-NNNN mint. Additive.
-- ============================================================================

create function public.sa_add_project_worker(
  p_project uuid,
  p_name text,
  p_national_id text,
  p_dob date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_yy     int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq    int;
  v_emp    text;
  v_worker uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'sa_add_project_worker: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_add_project_worker: not a member of this project' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'sa_add_project_worker: name required' using errcode = 'P0001';
  end if;
  if not public.is_valid_thai_national_id(p_national_id) then
    raise exception 'sa_add_project_worker: invalid Thai national-ID' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
    raise exception 'sa_add_project_worker: worker must be at least 18' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = p_national_id) then
    raise exception 'sa_add_project_worker: this national-ID is already on a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crew_registrations r where r.national_id = p_national_id and r.status = 'pending') then
    raise exception 'sa_add_project_worker: this national-ID is already a pending registration' using errcode = 'P0001';
  end if;

  insert into public.employee_id_counters (year, next_val) values (v_yy, 2)
  on conflict (year) do update set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;
  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  -- Active + project-bound + phoneless (no user_id). SA sets NO money: day_rate 0,
  -- level null, cost_confirmed_at null → excluded from cost/pay until a PM confirms.
  -- employment_type defaults to a daily 'temporary' hand (a PM may reclassify).
  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, tax_id, date_of_birth)
  values (v_name, 'daily', 'temporary', null, v_emp, 0,
          true, auth.uid(), p_project, p_national_id, p_dob)
  returning id into v_worker;

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, p_project, auth.uid(), 'sa direct add');

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', v_worker,
          jsonb_build_object('kind', 'create', 'source', 'sa_add', 'project_id', p_project,
                             'employee_id', v_emp));
  return v_worker;
end;
$$;
revoke all on function public.sa_add_project_worker(uuid, text, text, date) from public;
revoke execute on function public.sa_add_project_worker(uuid, text, text, date) from anon;
grant execute on function public.sa_add_project_worker(uuid, text, text, date) to authenticated;
