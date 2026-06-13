-- Spec 80 — project team / supervisors. Mirrors work_package_members (ADR 0032):
-- one row per (project, user), MUTABLE (members added/removed), PM/super manage,
-- staff read. Distinct from projects.project_lead_id (the single person-in-charge,
-- spec 79). Policies use the eval-once wrapped form ((select …)) from the start —
-- a bare current_user_role()/auth.uid() fails pgTAP file 40.

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.users(id),
  added_by   uuid not null references public.users(id),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

alter table public.project_members enable row level security;
revoke all on public.project_members from anon, authenticated;

grant select on public.project_members to authenticated;
grant insert (project_id, user_id, added_by) on public.project_members to authenticated;
grant delete on public.project_members to authenticated;

create policy "project members readable by staff"
  on public.project_members for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'super_admin'));

create policy "project members insert by pm or super_admin"
  on public.project_members for insert to authenticated
  with check ((select public.current_user_role()) in ('project_manager', 'super_admin')
              and added_by = (select auth.uid()));

create policy "project members delete by pm or super_admin"
  on public.project_members for delete to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin'));

comment on table public.project_members is
  'Project team/supervisors (spec 80). Mutable membership; PM/super manage, staff read. Distinct from projects.project_lead_id (single person-in-charge).';
