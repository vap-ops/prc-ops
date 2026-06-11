-- Spec 28 Part A / ADR 0032 — WP accountability metadata: single owner
-- column + crew join table. Display/accountability ONLY — membership is
-- never an access gate (ADR 0013 boundary); no policy may reference
-- work_package_members for visibility.

-- 1. Owner. Written through the existing PM/super UPDATE policy.
alter table public.work_packages
  add column owner_id uuid null references public.users(id);

-- 2. Crew. Deliberately MUTABLE (real DELETEs): assignment is
--    operational metadata, not evidence — the append-only ceremony is
--    for records that prove something happened (ADR 0032 records this
--    as the repo's first intentionally mutable domain table).
create table public.work_package_members (
  work_package_id uuid not null references public.work_packages(id) on delete cascade,
  user_id         uuid not null references public.users(id),
  added_by        uuid not null references public.users(id),
  added_at        timestamptz not null default now(),
  primary key (work_package_id, user_id)
);

create index work_package_members_user_idx
  on public.work_package_members (user_id);

-- 3. RLS + grants — revoke-all-first (platform default privileges).
alter table public.work_package_members enable row level security;
revoke all on public.work_package_members from anon, authenticated;

grant select on public.work_package_members to authenticated;
grant insert (work_package_id, user_id, added_by) on public.work_package_members to authenticated;
grant delete on public.work_package_members to authenticated;

-- Staff read; visitors excluded (same gate as work_packages itself).
create policy "members readable by privileged roles"
  on public.work_package_members
  for select
  to authenticated
  using (public.current_user_role() in ('site_admin', 'project_manager', 'super_admin'));

-- PM/super assign; added_by pinned to the caller.
create policy "members insert by pm or super_admin"
  on public.work_package_members
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('project_manager', 'super_admin')
    and added_by = auth.uid()
  );

create policy "members delete by pm or super_admin"
  on public.work_package_members
  for delete
  to authenticated
  using (public.current_user_role() in ('project_manager', 'super_admin'));
