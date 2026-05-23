-- ADR 0013: Create the projects table with role-level RLS.
-- See docs/decisions/0013-project-access-model.md.
--
-- Access model is role-level only for v1: site_admin / project_manager /
-- super_admin can SELECT every project; only super_admin can INSERT or
-- UPDATE. There is intentionally NO DELETE policy — projects are archived
-- via the status column, never hard-deleted via the app.
--
-- Policies call public.current_user_role() (ADR 0011) and never
-- self-join public.users. Self-joining public.users in a policy on a
-- table whose RLS reads public.users would re-introduce the recursion
-- ADR 0011 fixed.

-- 1. Enum for project lifecycle status. Present from day one so future
--    archive / on-hold UX has a typed home; no v1 logic gates on it.
create type public.project_status as enum (
  'active', 'on_hold', 'completed', 'archived'
);

-- 2. Projects table. `code` is human-assigned (PRC-YYYY-NNN convention,
--    not DB-generated) and unique. `id` is the FK target for future
--    work_packages.project_id.
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name       text not null,
  status     public.project_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. updated_at maintenance via the existing public.set_updated_at()
--    function (defined in 20260505143544_create_users.sql). Do NOT
--    redefine the function — attach a new trigger that calls it.
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- 4. RLS — role-level access per ADR 0013.
alter table public.projects enable row level security;

-- SELECT: site_admin / project_manager / super_admin can read all projects.
create policy "projects readable by privileged roles"
  on public.projects for select
  using (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

-- INSERT: super_admin only.
create policy "projects insert by super_admin"
  on public.projects for insert
  with check (public.current_user_role() = 'super_admin');

-- UPDATE: super_admin only. Both clauses gated so a super_admin cannot
-- transition a row out of their own visibility.
create policy "projects update by super_admin"
  on public.projects for update
  using      (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- DELETE: no policy. With RLS enabled and no DELETE policy, every DELETE
-- against this table affects 0 rows — including those issued by
-- super_admin through the application path. Hard deletes require a
-- service-role context (explicit migration / console action).
