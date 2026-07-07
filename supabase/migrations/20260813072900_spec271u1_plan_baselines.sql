-- Spec 271 U1 / ADR 0075 — plan baselines + variance snapshots (all additive).
--
-- plan_baselines / plan_baseline_items: append-only versioned snapshots of the
-- schedule. Live work_packages.planned_* stays freely editable (operational
-- lens); accountability variance scores against baseline v1 forever, except a
-- scope_change version, which re-anchors ONLY the leaves in its item diff (D3).
-- variance_snapshots: weekly per-leaf classification rows (written by the
-- report job from U2a's lib) — trend lines + tamper evidence: a derived actual
-- that moves after being classified shows up as snapshot drift (§3).
--
-- ACCESS POSTURE. Not money — planned dates are already staff-readable on
-- work_packages — so: RLS SELECT via can_see_project (site_owner/auditor
-- membership arms arrive in U3), zero write grants for authenticated. Writers:
-- U3 definer RPCs (propose/approve), the service-role report job (snapshots),
-- and migrations (the 004 backfill). Append-only = the approvals triple-layer
-- (grants · RLS without write policies · P0001 triggers). Leaf-only binding =
-- wp_reject_group_binding (spec 270); งานย่อย inherit their งาน's plan rows.

-- ---------------------------------------------------------------- baselines
create table public.plan_baselines (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id),
  version         integer not null,
  kind            public.plan_baseline_kind not null,
  reason          text null,
  as_of           timestamptz not null default now(),
  -- Per-project scoring switch (D8): NULL = calibration only, never scored.
  -- Carried on the initial row; a scored project sets it on day one.
  scoring_go_live date null,
  -- Nullable: the 004 backfill (and any migration-seeded row) has no acting
  -- user; U3's propose/approve RPCs always stamp both.
  proposed_by     uuid null references public.users(id),
  approved_by     uuid null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint plan_baselines_version_positive check (version >= 1),
  constraint plan_baselines_version_unique unique (project_id, version),
  constraint plan_baselines_scoring_initial_only
    check (scoring_go_live is null or kind = 'initial'),
  -- D3: every non-initial version explains itself.
  constraint plan_baselines_reason_required
    check (kind = 'initial' or length(btrim(coalesce(reason, ''))) > 0)
);

alter table public.plan_baselines enable row level security;
revoke all on public.plan_baselines from anon, authenticated;
grant select on public.plan_baselines to authenticated;

create policy "plan baselines readable in visible projects"
  on public.plan_baselines for select
  to authenticated
  using (public.can_see_project(project_id));

-- ---------------------------------------------------------------- items
create table public.plan_baseline_items (
  baseline_id     uuid not null references public.plan_baselines(id),
  work_package_id uuid not null references public.work_packages(id),
  -- NULL-dated leaves are OMITTED from a version (class `unplanned`), so both
  -- dates are NOT NULL here by construction.
  planned_start   date not null,
  planned_end     date not null,
  primary key (baseline_id, work_package_id),
  constraint plan_baseline_items_window check (planned_end >= planned_start)
);

alter table public.plan_baseline_items enable row level security;
revoke all on public.plan_baseline_items from anon, authenticated;
grant select on public.plan_baseline_items to authenticated;

create policy "plan baseline items readable in visible projects"
  on public.plan_baseline_items for select
  to authenticated
  using (exists (
    select 1 from public.plan_baselines b
    where b.id = baseline_id and public.can_see_project(b.project_id)
  ));

create trigger plan_baseline_items_reject_group_wp
  before insert or update on public.plan_baseline_items
  for each row execute function public.wp_reject_group_binding('work_package_id');

-- ---------------------------------------------------------------- snapshots
create table public.variance_snapshots (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id),
  work_package_id  uuid not null references public.work_packages(id),
  -- NULL = classified against the current plan; N = against baseline version N.
  baseline_version integer null,
  snapshot_date    date not null,
  class            public.variance_class not null,
  -- Signed days; NULL for classes that carry no slip (§3 rows 1/2/4).
  slip_days        integer null,
  created_at       timestamptz not null default now()
);

-- One row per leaf per date per lens. Two partial uniques because NULL never
-- collides in a plain unique (the dc_payments precedent).
create unique index variance_snapshots_current_lens_key
  on public.variance_snapshots (work_package_id, snapshot_date)
  where baseline_version is null;
create unique index variance_snapshots_baseline_lens_key
  on public.variance_snapshots (work_package_id, snapshot_date, baseline_version)
  where baseline_version is not null;

alter table public.variance_snapshots enable row level security;
revoke all on public.variance_snapshots from anon, authenticated;
grant select on public.variance_snapshots to authenticated;

create policy "variance snapshots readable in visible projects"
  on public.variance_snapshots for select
  to authenticated
  using (public.can_see_project(project_id));

create trigger variance_snapshots_reject_group_wp
  before insert or update on public.variance_snapshots
  for each row execute function public.wp_reject_group_binding('work_package_id');

-- ---------------------------------------------------------------- append-only, layer 3
-- Per-table functions (house style: the message names the table that refused).
create function public.plan_baselines_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'plan_baselines is append-only' using errcode = 'P0001';
end;
$$;

create function public.plan_baseline_items_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'plan_baseline_items is append-only' using errcode = 'P0001';
end;
$$;

create function public.variance_snapshots_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'variance_snapshots is append-only' using errcode = 'P0001';
end;
$$;

create trigger plan_baselines_block_update
  before update on public.plan_baselines
  for each row execute function public.plan_baselines_block_write();
create trigger plan_baselines_block_delete
  before delete on public.plan_baselines
  for each row execute function public.plan_baselines_block_write();
create trigger plan_baselines_block_truncate
  before truncate on public.plan_baselines
  for each statement execute function public.plan_baselines_block_write();

create trigger plan_baseline_items_block_update
  before update on public.plan_baseline_items
  for each row execute function public.plan_baseline_items_block_write();
create trigger plan_baseline_items_block_delete
  before delete on public.plan_baseline_items
  for each row execute function public.plan_baseline_items_block_write();
create trigger plan_baseline_items_block_truncate
  before truncate on public.plan_baseline_items
  for each statement execute function public.plan_baseline_items_block_write();

create trigger variance_snapshots_block_update
  before update on public.variance_snapshots
  for each row execute function public.variance_snapshots_block_write();
create trigger variance_snapshots_block_delete
  before delete on public.variance_snapshots
  for each row execute function public.variance_snapshots_block_write();
create trigger variance_snapshots_block_truncate
  before truncate on public.variance_snapshots
  for each statement execute function public.variance_snapshots_block_write();

comment on table public.plan_baselines is
  'Spec 271 / ADR 0075: append-only versioned plan snapshots. v1 = the accountability anchor (D3); scope_change versions re-anchor only their item diff. scoring_go_live NULL = unscored calibration (D8).';
comment on table public.plan_baseline_items is
  'Spec 271: per-leaf planned window inside one baseline version. NULL-dated leaves are omitted (class unplanned). Leaf-only (wp_reject_group_binding).';
comment on table public.variance_snapshots is
  'Spec 271 §3: weekly per-leaf variance classification (report job). Trend + tamper evidence — post-classification drift is visible. Leaf-only.';
