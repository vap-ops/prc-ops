-- Spec 195 Phase 1 / ADR 0063 — project-level purchasing: a purchase request's
-- work package becomes OPTIONAL; the PR is scoped to a project.
--
-- Procurement moves from WP-centric to project-level (operator, 2026-06-24):
-- material is bought for the project, received into the on-site store, and a
-- WP's material cost is attributed at withdrawal (เบิก), not at purchase. So a
-- PR may now be raised "ทั้งโครงการ / เข้าสโตร์" with no work package.
--
-- This is the security-sensitive foundation. It:
--   1. makes work_package_id NULLABLE and adds a NOT NULL project_id (backfilled
--      from each row's WP — all prod rows have a valid WP, the backfill is total);
--   2. derives project_id from the WP for a WP-bound PR via a BEFORE INSERT
--      trigger, so a WP-bound PR can never carry a project_id that disagrees with
--      its WP (a WP-bound insert may omit project_id entirely);
--   3. adds a PROJECT-scoped visibility arm to the SELECT policy and a WP-less
--      INSERT arm — WITHOUT widening WP-bound PR visibility (for a WP-bound row
--      can_see_project(project_id) is exactly can_see_wp(work_package_id), the
--      same project) and keeping the requester self-read + procurement reach.
--
-- The existing can_see_wp arms are KEPT (not replaced), so the qual/with_check
-- pins in pgTAP 17/70/73/115 stay green; the director role list is kept (pgTAP
-- 91); the policies are eval-once wrapped (pgTAP 40). RLS posture changes +
-- one new column → db:types regen expected.

-- ----------------------------------------------------------------------------
-- 1. Schema — WP optional, project_id added + backfilled + NOT NULL.
-- ----------------------------------------------------------------------------
alter table public.purchase_requests
  alter column work_package_id drop not null;

alter table public.purchase_requests
  add column project_id uuid references public.projects(id) on delete cascade;

-- Backfill from the WP's project (every existing PR is WP-bound today).
update public.purchase_requests pr
   set project_id = w.project_id
  from public.work_packages w
 where w.id = pr.work_package_id
   and pr.project_id is null;

alter table public.purchase_requests
  alter column project_id set not null;

comment on column public.purchase_requests.project_id is
  'ADR 0063 / spec 195 — the project a PR is scoped to (NOT NULL). For a WP-bound PR this is derived from the WP by purchase_requests_set_project_id(); a WP-less (store-bound) PR carries it directly.';

-- "list PRs for project X" — the project-level worklist / store flow.
create index purchase_requests_project_idx
  on public.purchase_requests (project_id);

-- ----------------------------------------------------------------------------
-- 2. Derive trigger — a WP-bound PR's project_id is authoritatively its WP's
--    project. SECURITY DEFINER so it resolves the WP regardless of the
--    inserter's RLS context; runs BEFORE INSERT so the NOT NULL check sees the
--    filled value (an insert may omit project_id for a WP-bound PR).
-- ----------------------------------------------------------------------------
create function public.purchase_requests_set_project_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.work_package_id is not null then
    select w.project_id into new.project_id
      from public.work_packages w
     where w.id = new.work_package_id;
  end if;
  return new;
end;
$$;

revoke all on function public.purchase_requests_set_project_id() from public, anon;

comment on function public.purchase_requests_set_project_id() is
  'ADR 0063 — BEFORE INSERT on purchase_requests: when work_package_id is set, force project_id to the WP''s project (removes a project_id/WP mismatch / visibility-misfile vector). WP-less PRs keep their client-set project_id.';

create trigger purchase_requests_set_project_id
  before insert on public.purchase_requests
  for each row execute function public.purchase_requests_set_project_id();

-- ----------------------------------------------------------------------------
-- 3. Column-scope grant — project_id is set once at INSERT (a new column does
--    not inherit the table's grants). UPDATE stays out (set-once).
-- ----------------------------------------------------------------------------
grant insert (project_id) on public.purchase_requests to authenticated;

-- ----------------------------------------------------------------------------
-- 4. RLS — add the project-scoped arms (sourced from the LIVE policies; arms
--    added, never replaced).
-- ----------------------------------------------------------------------------

-- SELECT: keep requester self-read + procurement + can_see_wp; ADD
-- can_see_project(project_id). For a WP-bound row the new arm is exactly the
-- can_see_wp arm (same project) — no widening; it only reaches WP-less PRs.
drop policy "purchase_requests select own or privileged" on public.purchase_requests;
create policy "purchase_requests select own or privileged"
  on public.purchase_requests for select
  using (
    requested_by = (select auth.uid())
    or (select public.current_user_role()) = 'procurement'
    or (select public.can_see_wp(work_package_id))
    or (select public.can_see_project(project_id))
  );

-- INSERT: keep requester-self + source='app'; the sa/pm/super/director arm now
-- branches — WP-bound gates on can_see_wp (unchanged), WP-less gates on
-- can_see_project(project_id); the procurement cross-project arm is unchanged.
drop policy "purchase_requests insert by wp-readers" on public.purchase_requests;
create policy "purchase_requests insert by wp-readers"
  on public.purchase_requests for insert
  with check (
    requested_by = (select auth.uid())
    and source = 'app'
    and (
      (
        (select public.current_user_role())
          in ('site_admin', 'project_manager', 'super_admin', 'project_director')
        and (
          (work_package_id is not null and (select public.can_see_wp(work_package_id)))
          or (work_package_id is null and (select public.can_see_project(project_id)))
        )
      )
      or (select public.current_user_role()) = 'procurement'
    )
  );
