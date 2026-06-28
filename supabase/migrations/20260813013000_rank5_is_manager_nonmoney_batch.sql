-- Architecture-quality audit rank 5 (sql-role-helpers), stage 2 — batch 2.
--
-- Adopt the SSOT predicate public.is_manager() (migration 20260813003200) in the
-- inline manager gate of the NON-MONEY exact-PM-3 RPCs. Each gate
--   [public.]current_user_role() not in ('project_manager','super_admin','project_director')
-- becomes
--   not public.is_manager(public.current_user_role())
-- the SQL counterpart of isManagerRole (src/lib/auth/role-home.ts).
--
-- BEHAVIOUR-PRESERVING: is_manager(role) is defined as exactly that three-role
-- set and pgTAP 231 asserts TS<->SQL parity, so access is unchanged. Each body is
-- sourced VERBATIM from LIVE via pg_get_functiondef; the ONLY edit is the gate
-- predicate (one regex match asserted per function by the generator). CREATE OR
-- REPLACE preserves the existing EXECUTE grants (anon already revoked; pgTAP 229
-- re-confirms). Money/GL/bank exact-PM-3 gates are a separate later unit.
--
-- Functions (18): add_work_package_dependency, apply_wp_template, clone_work_packages, create_deliverable, create_project, create_work_package, dismiss_project_onboarding, project_onboarding_status, remove_work_package_dependency, set_deliverable_name, set_project_client, set_work_package_deliverable, set_work_package_name, set_work_package_schedule, suggest_project_code, supply_plan_accuracy, swap_deliverable_order, update_project_settings.

-- add_work_package_dependency
CREATE OR REPLACE FUNCTION public.add_work_package_dependency(p_predecessor uuid, p_successor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'add_work_package_dependency: role not permitted' using errcode = '42501';
  end if;

  if p_predecessor = p_successor then
    return false;
  end if;

  -- both WPs must exist and share a project.
  if not exists (
    select 1 from public.work_packages a
      join public.work_packages b on a.project_id = b.project_id
     where a.id = p_predecessor and b.id = p_successor
  ) then
    return false;
  end if;

  -- cycle guard: reject if the successor can already reach the predecessor
  -- (adding predecessor -> successor would close a loop).
  if exists (
    with recursive reach as (
      select successor_id as node
        from public.work_package_dependencies
       where predecessor_id = p_successor
      union
      select d.successor_id
        from public.work_package_dependencies d
        join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = p_predecessor
  ) then
    return false;
  end if;

  insert into public.work_package_dependencies (predecessor_id, successor_id, created_by)
  values (p_predecessor, p_successor, auth.uid())
  on conflict (predecessor_id, successor_id) do nothing;
  return true;
end;
$function$;

-- apply_wp_template
CREATE OR REPLACE FUNCTION public.apply_wp_template(p_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type  public.project_type;
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'apply_wp_template: role not permitted' using errcode = '42501';
  end if;
  select p.project_type into v_type from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'apply_wp_template: unknown project' using errcode = '22023';
  end if;
  if v_type is null then
    return 0;
  end if;

  insert into public.work_packages (project_id, code, name, description)
    select p_project_id, t.code, t.name, t.description
      from public.wp_templates t
     where t.project_type = v_type
     order by t.sort_order
  on conflict (project_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- clone_work_packages
CREATE OR REPLACE FUNCTION public.clone_work_packages(p_src_project_id uuid, p_dst_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'clone_work_packages: role not permitted' using errcode = '42501';
  end if;
  if p_src_project_id = p_dst_project_id then
    raise exception 'clone_work_packages: source and destination must differ'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_src_project_id)
     or not exists (select 1 from public.projects p where p.id = p_dst_project_id) then
    raise exception 'clone_work_packages: unknown project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description)
    select p_dst_project_id, w.code, w.name, w.description
      from public.work_packages w
     where w.project_id = p_src_project_id
  on conflict (project_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- create_deliverable
CREATE OR REPLACE FUNCTION public.create_deliverable(p_project_id uuid, p_code text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_sort integer;
  v_id   uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_deliverable: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_deliverable: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_deliverable: invalid name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_deliverable: unknown project' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort
    from public.deliverables where project_id = p_project_id;

  insert into public.deliverables (project_id, code, name, sort_order)
  values (p_project_id, v_code, v_name, v_sort)
  returning id into v_id;

  return v_id;
end;
$function$;

-- create_project
CREATE OR REPLACE FUNCTION public.create_project(p_code text, p_name text, p_project_type project_type DEFAULT NULL::project_type, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_uid  uuid := auth.uid();
  v_id   uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_project: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_project: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_project: invalid name' using errcode = '22023';
  end if;
  if p_client_id is not null
     and not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'create_project: unknown client' using errcode = '22023';
  end if;

  insert into public.projects (code, name, project_type, client_id)
  values (v_code, v_name, p_project_type, p_client_id)
  returning id into v_id;

  -- The onboarding PM joins the team. added_by = creator = self.
  insert into public.project_members (project_id, user_id, added_by)
  values (v_id, v_uid, v_uid);

  return v_id;
end;
$function$;

-- create_work_package
CREATE OR REPLACE FUNCTION public.create_work_package(p_project_id uuid, p_code text, p_name text, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id   uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_work_package: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_work_package: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_work_package: invalid name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_work_package: unknown project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description)
  values (p_project_id, v_code, v_name, v_desc)
  returning id into v_id;

  return v_id;
end;
$function$;

-- dismiss_project_onboarding
CREATE OR REPLACE FUNCTION public.dismiss_project_onboarding(p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'dismiss_project_onboarding: role not permitted' using errcode = '42501';
  end if;
  update public.projects
     set onboarding_dismissed_at = now()
   where id = p_project_id;
  return found;
end;
$function$;

-- project_onboarding_status
CREATE OR REPLACE FUNCTION public.project_onboarding_status(p_project_id uuid)
 RETURNS TABLE(dates_lead_set boolean, budget_set boolean, team_added boolean, work_packages_added boolean, client_set boolean, dismissed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'project_onboarding_status: role not permitted' using errcode = '42501';
  end if;
  return query
    select
      (p.start_date is not null and p.project_lead_id is not null),
      (p.budget_amount_thb is not null),
      exists (select 1 from public.project_members m where m.project_id = p.id),
      exists (select 1 from public.work_packages w where w.project_id = p.id),
      (p.client_id is not null),
      (p.onboarding_dismissed_at is not null)
    from public.projects p
    where p.id = p_project_id;
end;
$function$;

-- remove_work_package_dependency
CREATE OR REPLACE FUNCTION public.remove_work_package_dependency(p_predecessor uuid, p_successor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'remove_work_package_dependency: role not permitted' using errcode = '42501';
  end if;
  delete from public.work_package_dependencies
   where predecessor_id = p_predecessor and successor_id = p_successor;
  return found;
end;
$function$;

-- set_deliverable_name
CREATE OR REPLACE FUNCTION public.set_deliverable_name(p_deliverable_id uuid, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name       text := btrim(coalesce(p_name, ''));
  v_project_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_deliverable_name: role not permitted'
      using errcode = '42501';
  end if;

  select project_id into v_project_id
    from public.deliverables where id = p_deliverable_id;
  if v_project_id is null or not public.can_see_project(v_project_id) then
    raise exception 'set_deliverable_name: not a member of this project'
      using errcode = '42501';
  end if;

  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'set_deliverable_name: invalid name'
      using errcode = '22023';
  end if;

  update public.deliverables
     set name = v_name
   where id = p_deliverable_id;
  return found;
end;
$function$;

-- set_project_client
CREATE OR REPLACE FUNCTION public.set_project_client(p_project_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_project_client: role not permitted' using errcode = '42501';
  end if;
  if p_client_id is not null
     and not exists (select 1 from public.clients c where c.id = p_client_id) then
    return false;
  end if;
  update public.projects set client_id = p_client_id where id = p_project_id;
  return found;
end;
$function$;

-- set_work_package_deliverable
CREATE OR REPLACE FUNCTION public.set_work_package_deliverable(p_work_package_id uuid, p_deliverable_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id     uuid;
  v_del_project_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_work_package_deliverable: role not permitted'
      using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'set_work_package_deliverable: not a member of this project'
      using errcode = '42501';
  end if;

  select project_id into v_project_id
    from public.work_packages where id = p_work_package_id;
  if not found then
    return false;
  end if;

  if p_deliverable_id is not null then
    select project_id into v_del_project_id
      from public.deliverables where id = p_deliverable_id;
    if not found then
      raise exception 'set_work_package_deliverable: unknown deliverable'
        using errcode = '22023';
    end if;
    if v_del_project_id <> v_project_id then
      raise exception 'set_work_package_deliverable: deliverable belongs to another project'
        using errcode = '22023';
    end if;
  end if;

  update public.work_packages
     set deliverable_id = p_deliverable_id
   where id = p_work_package_id;
  return true;
end;
$function$;

-- set_work_package_name
CREATE OR REPLACE FUNCTION public.set_work_package_name(p_work_package_id uuid, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_work_package_name: role not permitted'
      using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'set_work_package_name: not a member of this project'
      using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'set_work_package_name: invalid name'
      using errcode = '22023';
  end if;

  update public.work_packages
     set name = v_name
   where id = p_work_package_id;
  return found;
end;
$function$;

-- set_work_package_schedule
CREATE OR REPLACE FUNCTION public.set_work_package_schedule(p_work_package_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_work_package_schedule: role not permitted' using errcode = '42501';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    return false;
  end if;
  update public.work_packages
     set planned_start = p_start, planned_end = p_end
   where id = p_work_package_id;
  return found;
end;
$function$;

-- suggest_project_code
CREATE OR REPLACE FUNCTION public.suggest_project_code()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_max  int;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'suggest_project_code: role not permitted' using errcode = '42501';
  end if;
  select coalesce(max(substring(code from '^PRC-' || v_year || '-([0-9]+)$')::int), 0)
    into v_max
    from public.projects
   where code ~ ('^PRC-' || v_year || '-[0-9]+$');
  return 'PRC-' || v_year || '-' || lpad((v_max + 1)::text, 3, '0');
end;
$function$;

-- supply_plan_accuracy
CREATE OR REPLACE FUNCTION public.supply_plan_accuracy(p_project_id uuid)
 RETURNS TABLE(work_package_id uuid, wp_code text, wp_name text, planned_lines integer, planned_qty numeric, unplanned_miss integer, fair_reactive integer, untagged integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'supply_plan_accuracy: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'supply_plan_accuracy: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project_id) then
    raise exception 'supply_plan_accuracy: unknown project' using errcode = '22023';
  end if;

  return query
  with planned as (
    select spl.work_package_id as wp,
           count(*)::int as planned_lines,
           coalesce(sum(spl.qty), 0)::numeric as planned_qty
      from public.supply_plan_lines spl
      join public.supply_plans sp on sp.id = spl.supply_plan_id
     where sp.project_id = p_project_id
     group by spl.work_package_id
  ),
  prs as (
    select w.id as wp,
           count(*) filter (where r.reason_code = 'unplanned_miss')::int as unplanned_miss,
           count(*) filter (
             where r.reason_code in ('rework', 'breakage', 'scope_change', 'unforeseeable')
           )::int as fair_reactive,
           count(*) filter (where r.reason_code is null)::int as untagged
      from public.purchase_requests r
      join public.work_packages w on w.id = r.work_package_id
     where w.project_id = p_project_id
       -- Spec 181 U3: plan-generated PRs are PLANNED, not reactive — exclude them.
       and r.supply_plan_line_id is null
     group by w.id
  ),
  merged as (
    select coalesce(planned.wp, prs.wp) as wp,
           coalesce(planned.planned_lines, 0) as planned_lines,
           coalesce(planned.planned_qty, 0) as planned_qty,
           coalesce(prs.unplanned_miss, 0) as unplanned_miss,
           coalesce(prs.fair_reactive, 0) as fair_reactive,
           coalesce(prs.untagged, 0) as untagged
      from planned
      full outer join prs
        on coalesce(planned.wp, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(prs.wp, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  select m.wp, w.code, w.name,
         m.planned_lines, m.planned_qty,
         m.unplanned_miss, m.fair_reactive, m.untagged
    from merged m
    left join public.work_packages w on w.id = m.wp
   order by m.unplanned_miss desc, w.code asc nulls last;
end;
$function$;

-- swap_deliverable_order
CREATE OR REPLACE FUNCTION public.swap_deliverable_order(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_a_project uuid;
  v_b_project uuid;
  v_a_sort    integer;
  v_b_sort    integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'swap_deliverable_order: role not permitted' using errcode = '42501';
  end if;

  select project_id, sort_order into v_a_project, v_a_sort
    from public.deliverables where id = p_a;
  select project_id, sort_order into v_b_project, v_b_sort
    from public.deliverables where id = p_b;

  if v_a_project is null or v_b_project is null or not public.can_see_project(v_a_project) then
    raise exception 'swap_deliverable_order: not a member of this project' using errcode = '42501';
  end if;
  if v_a_project <> v_b_project then
    raise exception 'swap_deliverable_order: deliverables are in different projects'
      using errcode = '22023';
  end if;

  update public.deliverables
     set sort_order = case id when p_a then v_b_sort when p_b then v_a_sort end
   where id in (p_a, p_b);
  return true;
end;
$function$;

-- update_project_settings
CREATE OR REPLACE FUNCTION public.update_project_settings(p_project_id uuid, p_name text, p_status project_status, p_notes text DEFAULT NULL::text, p_site_address text DEFAULT NULL::text, p_planned_completion_date date DEFAULT NULL::date, p_budget_amount_thb numeric DEFAULT NULL::numeric, p_start_date date DEFAULT NULL::date, p_project_lead_id uuid DEFAULT NULL::uuid, p_project_type project_type DEFAULT NULL::project_type, p_gmap_url text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_project_settings: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'update_project_settings: invalid name' using errcode = '22023';
  end if;
  if p_planned_completion_date is not null and p_planned_completion_date < current_date then
    raise exception 'update_project_settings: completion date cannot be past' using errcode = '22023';
  end if;
  if p_budget_amount_thb is not null and p_budget_amount_thb < 0 then
    raise exception 'update_project_settings: budget cannot be negative' using errcode = '22023';
  end if;
  if p_project_lead_id is not null
     and not exists (select 1 from public.users u where u.id = p_project_lead_id) then
    raise exception 'update_project_settings: unknown project lead' using errcode = '22023';
  end if;

  update public.projects
     set name   = v_name,
         status = p_status,
         notes  = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
         site_address = case when p_site_address is null then site_address
                             else nullif(btrim(p_site_address), '') end,
         gmap_url = case when p_gmap_url is null then gmap_url
                         else nullif(btrim(p_gmap_url), '') end,
         start_date              = coalesce(p_start_date, start_date),
         planned_completion_date = coalesce(p_planned_completion_date, planned_completion_date),
         project_lead_id         = coalesce(p_project_lead_id, project_lead_id),
         project_type            = coalesce(p_project_type, project_type),
         budget_amount_thb       = coalesce(p_budget_amount_thb, budget_amount_thb)
   where id = p_project_id;
  return found;
end;
$function$;
