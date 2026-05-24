-- Create the photo_logs table — append-only progress photos against a
-- work_package, with tombstone-supersede for removals.
--
-- ADR 0015 documents the tombstone-supersede mechanism: removal is an
-- INSERT of a tombstone row (storage_path NULL, superseded_by → the
-- removed photo) rather than UPDATE/DELETE. Replacement is two appends
-- (tombstone old + INSERT new), not a single statement.
--
-- Append-only is triple-enforced exactly like audit_log
-- (supabase/migrations/20260505143800_create_audit_log.sql):
--   1. Privilege:  REVOKE UPDATE/DELETE from authenticated and anon.
--                  GRANT INSERT, SELECT to authenticated.
--   2. RLS:        policies for INSERT + SELECT only (no UPDATE policy,
--                  no DELETE policy).
--   3. Trigger:    BEFORE UPDATE OR DELETE raises P0001. Catches the
--                  service_role / superuser path that bypasses layers 1
--                  and 2.
--
-- Access model is role-level per ADR 0013, via public.current_user_role()
-- (ADR 0011 helper — never self-join public.users in a policy that gates
-- on it). INSERT and SELECT are both gated to
-- (site_admin, project_manager, super_admin); all three roles upload AND
-- create tombstones (no separate moderator role in v1).
--
-- The well-formedness CHECK
--   ((storage_path IS NULL) = (superseded_by IS NOT NULL))
-- makes every row provably either a real photo (path set, supersedes
-- nothing) or a valid tombstone (no path, supersedes something) — never
-- malformed. Documented in ADR 0015 as the load-bearing integrity
-- invariant the read pattern relies on.

-- 1. Enum for photo lifecycle phase.
create type public.photo_phase as enum ('before', 'during', 'after');

-- 2. Photo logs table. Grain = one row per photo. Multiple photos per
--    (work_package_id, phase) are expected. Edits do not exist; the
--    table is strictly append-only. created_at is server-authoritative;
--    captured_at_client is UNTRUSTED device-reported time stored only
--    for display in the eventual PDF report.
create table public.photo_logs (
  id                 uuid primary key default gen_random_uuid(),
  work_package_id    uuid not null
                       references public.work_packages(id) on delete cascade,
  phase              public.photo_phase not null,
  storage_path       text,
  superseded_by      uuid references public.photo_logs(id),
  uploaded_by        uuid not null references public.users(id),
  created_at         timestamptz not null default now(),
  captured_at_client timestamptz,
  -- ADR 0015 well-formedness invariant: every row is either a real
  -- photo (storage_path set, superseded_by NULL) or a valid tombstone
  -- (storage_path NULL, superseded_by set) — never malformed.
  constraint photo_logs_path_supersede_well_formed
    check ((storage_path is null) = (superseded_by is not null))
);

-- ON DELETE CASCADE on work_package_id is a defensive consistency default
-- for the case where a WP is hard-deleted at the service-role layer (the
-- application path is no-DELETE per ADR 0013). The application never
-- invokes this path.

-- 3. Indexes. ADR 0009 requires a partial index on superseded_by because
--    the anti-join current-state query runs on every user-facing read;
--    the partial form (WHERE superseded_by IS NOT NULL) only stores rows
--    that supersede something, which is the rowset the anti-join cares
--    about. The work_package_id index supports the standard "list photos
--    for this WP" lookup. A composite (work_package_id, phase) index is
--    intentionally deferred — measure first against real query plans.
create index photo_logs_superseded_by_idx
  on public.photo_logs (superseded_by)
  where superseded_by is not null;

create index photo_logs_work_package_id_idx
  on public.photo_logs (work_package_id);

-- 4. Triple-enforcement, layer 1: privilege.
-- authenticated may INSERT (uploads + tombstones) and SELECT. UPDATE and
-- DELETE privileges are not granted. anon has no access (no public read
-- surface). service_role retains all privileges by default; layer 3
-- catches its UPDATE/DELETE attempts.
revoke all on public.photo_logs from authenticated, anon;
grant insert, select on public.photo_logs to authenticated;

-- 5. Triple-enforcement, layer 2: RLS. INSERT + SELECT policies only;
--    NO UPDATE policy, NO DELETE policy. All policies gate on
--    public.current_user_role() per ADR 0011 — never self-joining
--    public.users.
alter table public.photo_logs enable row level security;

create policy "photo_logs readable by privileged roles"
  on public.photo_logs for select
  using (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

create policy "photo_logs insert by sa/pm/super"
  on public.photo_logs for insert
  with check (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

-- 6. Triple-enforcement, layer 3: trigger raises on every UPDATE/DELETE
--    attempt, catching the service_role / superuser path that bypasses
--    layers 1 and 2. Function shape mirrors audit_log_block_write() in
--    20260505143800_create_audit_log.sql; the message differs so the
--    error identifies which table refused the write.
create function public.photo_logs_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'photo_logs is append-only'
    using errcode = 'P0001';
end;
$$;

create trigger photo_logs_block_update
  before update on public.photo_logs
  for each row execute function public.photo_logs_block_write();

create trigger photo_logs_block_delete
  before delete on public.photo_logs
  for each row execute function public.photo_logs_block_write();
