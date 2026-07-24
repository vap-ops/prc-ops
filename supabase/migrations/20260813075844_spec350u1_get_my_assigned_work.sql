-- Spec 350 U1 — get_my_assigned_work(): a bound worker (technician) reads the
-- work packages of their MOST-RECENT muster team, each with the fields to render
-- status + parent-งาน progress. Self-scoped via workers.user_id = auth.uid();
-- DEFINER because the muster tables are can_see_project-scoped (false for a
-- technician). Read-only, money-free. group_child_statuses carries the relevant
-- งาน's children (group row → its own children; leaf row → its parent's children)
-- so the caller can compute the % with deriveDeliverableProgress in TS.

create function public.get_my_assigned_work()
returns table (
  wp_id                uuid,
  code                 text,
  name                 text,
  is_group             boolean,
  status               public.work_package_status,
  parent_id            uuid,
  parent_code          text,
  parent_name          text,
  group_child_statuses public.work_package_status[],
  work_date            date
) language sql stable security definer set search_path = public as $$
  with latest as (
    select a.team_id, a.work_date
      from public.muster_attendance a
      join public.workers w on w.id = a.worker_id
     where w.user_id = auth.uid()
     order by a.work_date desc, a.id desc
     limit 1
  )
  select
    wp.id, wp.code, wp.name, wp.is_group, wp.status, wp.parent_id,
    p.code, p.name,
    coalesce((
      select array_agg(c.status order by c.code)
        from public.work_packages c
       where c.parent_id = case when wp.is_group then wp.id else wp.parent_id end
    ), '{}'::public.work_package_status[]),
    latest.work_date
  from latest
  join public.muster_team_wps mtw on mtw.team_id = latest.team_id
  join public.work_packages wp on wp.id = mtw.work_package_id
  left join public.work_packages p on p.id = wp.parent_id
  order by wp.code;
$$;
revoke all on function public.get_my_assigned_work() from public;
revoke execute on function public.get_my_assigned_work() from anon;
grant execute on function public.get_my_assigned_work() to authenticated;
