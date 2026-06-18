-- Spec 145 U1 — lock new work on a completed/archived project.
--
-- Operator: a project locks once completed. Important caveat: completion is NOT
-- full closure — the client retains a warranty % (Buildall: 5% for a year), and
-- defects surface during that warranty window. So the lock must block NEW work
-- but must NOT block warranty defect-rework.
--
-- Enforcement = a BEFORE INSERT trigger on work_packages: one chokepoint over
-- every WP-creation path (create_work_package, clone_work_packages,
-- apply_wp_template, the CSV import that calls create_work_package) without
-- touching those RPCs. It is INSERT-only, so reopen_work_package_for_defect
-- (spec 144, an UPDATE complete → rework) and the reworked WP's capture/labor/
-- approval cycle all keep working on a completed project — the warranty path.
--
-- Out of scope (deliberately): the retention % / warranty-period billing is a
-- finance concern the app resists (status-only billing at most); not built here.
-- The project record itself stays editable (so status can move completed →
-- active to reopen, and retention/warranty notes can be recorded).

create function public.project_is_open(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project_id and p.status in ('active', 'on_hold')
  );
$$;

revoke all on function public.project_is_open(uuid) from public, anon;
grant execute on function public.project_is_open(uuid) to authenticated;

comment on function public.project_is_open(uuid) is
  'Spec 145 — true if a project accepts new work (status active/on_hold). completed/archived = closed (false). Definer so callers/triggers read status regardless of RLS.';

create function public.work_packages_block_insert_on_closed_project()
returns trigger
language plpgsql
as $$
begin
  if not public.project_is_open(NEW.project_id) then
    raise exception 'cannot add a work package to a closed (completed/archived) project'
      using errcode = 'P0002';
  end if;
  return NEW;
end;
$$;

-- BEFORE INSERT only — reopen-to-rework (an UPDATE) is intentionally untouched
-- so warranty defect-rework still works on a completed project.
create trigger work_packages_block_insert_on_closed_project
  before insert on public.work_packages
  for each row execute function public.work_packages_block_insert_on_closed_project();
