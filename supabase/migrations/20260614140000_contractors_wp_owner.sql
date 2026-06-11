-- Spec 31 / ADR 0033 — contractors master table + WP contractor owner.
-- Replaces the ADR 0032 user-owner UI; owner_id/work_package_members
-- stay dormant (cleanup candidates at v2).

create table public.contractors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint contractors_name_nonblank check (length(trim(name)) > 0)
);

alter table public.work_packages
  add column contractor_id uuid null references public.contractors(id);

-- RLS + grants — revoke-all-first (platform default privileges).
alter table public.contractors enable row level security;
revoke all on public.contractors from anon, authenticated;

grant select on public.contractors to authenticated;
grant insert (id, name, phone, created_by) on public.contractors to authenticated;
grant update (name, phone) on public.contractors to authenticated;
-- NO delete grant/policy: a contractor that worked a WP stays
-- referencable forever; pruning is a service-role concern (ADR 0033).

create policy "contractors readable by privileged roles"
  on public.contractors
  for select
  to authenticated
  using (public.current_user_role() in ('site_admin', 'project_manager', 'super_admin'));

create policy "contractors insert by pm or super_admin"
  on public.contractors
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('project_manager', 'super_admin')
    and created_by = auth.uid()
  );

create policy "contractors update by pm or super_admin"
  on public.contractors
  for update
  to authenticated
  using (public.current_user_role() in ('project_manager', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'super_admin'));
