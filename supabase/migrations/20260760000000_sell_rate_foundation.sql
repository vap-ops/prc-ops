-- Spec 161 U1 / ADR 0060 (Accepted) — per-level rate foundation: the first
-- economics unit on the Stage-0 spine (spec 160). Worker skill `level` + the
-- editable, seeded `sell_rate_table` (the baht cost/sell DIALS the WP P&L will
-- read in U3). Every value is operator-tunable data, not a hardcoded constant.
--
-- MONEY posture: sell prices are margin-sensitive → zero authenticated grant
-- (the day_rate posture, spec 46); the operator surface reads via the admin
-- client behind requireRole(super_admin), writes via set_sell_rate. Grading +
-- rate-setting are super_admin only (operator economics; anti-favoritism §5) —
-- no project_manager reference, so the ADR 0058 pgTAP 90/91 invariants don't
-- apply. NO economics math reads these yet — that is U3.

-- 1. Worker skill level (ADR 0060 §1; values evolve via `add value`).
create type public.worker_level as enum ('senior', 'mid', 'junior', 'apprentice');

alter table public.workers add column level public.worker_level null;
-- level is a category, not money (like worker_type) — staff may read it.
grant select (level) on public.workers to authenticated;

-- 2. The editable per-level rate dials. One row per level; baht amounts.
create table public.sell_rate_table (
  level         public.worker_level primary key,
  cost_band     numeric(20, 4) not null,
  internal_sell numeric(20, 4) not null,
  external_sell numeric(20, 4) not null,
  updated_by    uuid null references public.users(id),
  updated_at    timestamptz not null default now(),
  constraint sell_rate_nonnegative
    check (cost_band >= 0 and internal_sell >= 0 and external_sell >= 0)
);

alter table public.sell_rate_table enable row level security;
-- Zero grant: no anon/authenticated access at all. The operator reads via the
-- admin client (requireRole super_admin); set_sell_rate (definer) is the writer.
revoke all on public.sell_rate_table from anon, authenticated;

comment on table public.sell_rate_table is
  'Editable per-level baht rate dials (spec 161 U1 / ADR 0060): cost band + internal-WP sell + external-WP sell, one row per worker_level. MONEY — zero authenticated grant; operator-tuned via set_sell_rate. Read by the WP P&L (U3), not built yet.';

-- Seeded with recommended defaults (illustrative; the operator retunes in-app).
insert into public.sell_rate_table (level, cost_band, internal_sell, external_sell) values
  ('senior',     650, 800, 950),
  ('mid',        550, 700, 850),
  ('junior',     450, 580, 720),
  ('apprentice', 380, 480, 600);

-- 3. set_worker_level — super_admin grades a worker (objective criteria, §5).
--    Reuses the worker_change audit action (payload.kind discriminates).
create function public.set_worker_level(p_worker uuid, p_level public.worker_level)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'set_worker_level: role not permitted' using errcode = '42501';
  end if;
  select true into v_exists from public.workers where id = p_worker;
  if not found then
    raise exception 'set_worker_level: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set level = p_level where id = p_worker;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_worker, jsonb_build_object('kind', 'level_change', 'level', p_level));
end;
$$;

-- 4. set_sell_rate — super_admin tunes a level's baht dials.
create function public.set_sell_rate(
  p_level public.worker_level,
  p_cost_band numeric,
  p_internal_sell numeric,
  p_external_sell numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.sell_rate_table%rowtype;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'set_sell_rate: role not permitted' using errcode = '42501';
  end if;
  if p_cost_band is null or p_cost_band < 0
     or p_internal_sell is null or p_internal_sell < 0
     or p_external_sell is null or p_external_sell < 0 then
    raise exception 'set_sell_rate: rates must be non-negative' using errcode = 'P0001';
  end if;
  select * into v_old from public.sell_rate_table where level = p_level;
  if not found then
    raise exception 'set_sell_rate: unknown level' using errcode = 'P0001';
  end if;

  update public.sell_rate_table
     set cost_band = p_cost_band, internal_sell = p_internal_sell,
         external_sell = p_external_sell, updated_by = auth.uid(), updated_at = now()
   where level = p_level;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'sell_rate_table', null,
          jsonb_build_object('entity', 'sell_rate', 'level', p_level,
            'old', jsonb_build_object('cost_band', v_old.cost_band,
              'internal_sell', v_old.internal_sell, 'external_sell', v_old.external_sell),
            'new', jsonb_build_object('cost_band', p_cost_band,
              'internal_sell', p_internal_sell, 'external_sell', p_external_sell)));
end;
$$;
