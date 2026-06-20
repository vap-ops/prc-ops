-- Spec 160 U1 / ADR 0061 (invariant 1) — DC as a durable person + project
-- assignment. The `workers` row IS the lifelong person; the PROJECT is the
-- current assignment (one at a time, nullable until assigned), backed by an
-- append-only move history (mirrors equipment_movements, ADR 0055). The
-- original schema (spec 46) force-tied a DC to a contractor; that tie is now
-- DROPPED — a DC belongs to a project, not a crew (the pay-model reality and
-- the fix behind spec 158). Additive + reversible; NO economics here.
--
-- MONEY POSTURE: unchanged. project_id is not money → readable like the other
-- non-rate columns; day_rate keeps its zero authenticated grant.

-- 1. Current assignment: a single, nullable project (populated going forward;
--    no backfill of existing DCs here — separate data-only follow-up).
alter table public.workers
  add column project_id uuid null references public.projects(id);

grant select (project_id) on public.workers to authenticated;

-- 2. Drop the DC-contractor force-tie. A DC may now have a null contractor
--    (contractor_id stays — optional, back-compat). own-has-no-contractor stays.
alter table public.workers drop constraint workers_dc_has_contractor;

-- 3. worker_project_moves — append-only move stream. project_id NULL = moved
--    out / unassigned. The current assignment is workers.project_id; this stream
--    is the audit trail. Immutable: no UPDATE/DELETE. RLS on; ZERO write grant —
--    the only write path is the SECURITY DEFINER RPC below (definer = table
--    owner, so its inserts bypass the absent insert grant + RLS).
create table public.worker_project_moves (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid not null references public.workers(id),
  project_id uuid null references public.projects(id),
  moved_at   timestamptz not null default now(),
  moved_by   uuid not null references public.users(id),
  reason     text null
);

create index worker_project_moves_worker_idx
  on public.worker_project_moves (worker_id, moved_at desc);

alter table public.worker_project_moves enable row level security;
revoke all on public.worker_project_moves from anon, authenticated;

-- SELECT only (the stream is the staff-readable audit trail). No INSERT/UPDATE/
-- DELETE grant or policy — writes go through assign_worker_to_project.
grant select on public.worker_project_moves to authenticated;

create policy "worker_project_moves readable by staff"
  on public.worker_project_moves for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

comment on table public.worker_project_moves is
  'Append-only DC project-assignment history (spec 160 U1 / ADR 0061 invariant 1). Current assignment = workers.project_id; this is the move trail. Immutable (no update/delete); written only via assign_worker_to_project. project_id NULL = moved out / unassigned.';

-- 4. assign_worker_to_project — sets the current project AND appends a move row
--    + an audit_log row in one tx. pm/super only (assignment is a roster
--    decision, like the other worker RPCs) -> else 42501. Reuses the
--    worker_change audit action; payload.kind discriminates (create / update /
--    rate_change / project_move).
create function public.assign_worker_to_project(
  p_worker uuid,
  p_project uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'assign_worker_to_project: role not permitted' using errcode = '42501';
  end if;
  select true into v_exists from public.workers where id = p_worker;
  if not found then
    raise exception 'assign_worker_to_project: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set project_id = p_project where id = p_worker;

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (p_worker, p_project, auth.uid(), v_reason);

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_worker, jsonb_build_object('kind', 'project_move',
                                       'project_id', p_project,
                                       'reason', v_reason));
end;
$$;
