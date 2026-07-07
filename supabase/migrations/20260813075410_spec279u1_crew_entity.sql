-- ============================================================================
-- Spec 279 U1 / ADR 0079 — self-governance onboarding: the crew entity + dedup key.
--
-- The roster spine spec 278's attendance muster reads. Additive only.
--   * `crews`         — a project-scoped org unit with a named accountable head
--                       (`lead_worker_id`), a dc|subcon `kind`, and a PM-set
--                       `default_day_rate` (money → zero authenticated grant).
--   * `crew_members`  — the SSOT of membership; append-only tombstone; a partial-
--                       unique index makes a human belong to at most ONE active crew.
--   * `workers.tax_id` firm-wide partial-unique = the anti-ghost / anti-double-count
--                       dedup key (the 13-digit Thai national/tax id). Format/checksum
--                       validation is the U2 add-member RPC's job (migrant-safe branch),
--                       NOT a rigid table CHECK.
--   * `create_crew` / `reassign_crew_lead` — SECURITY DEFINER writes, gated on
--                       `is_back_office` (the live 5-role onboarding set ≡ WORKER_ROSTER_ROLES).
--   * `current_user_led_crew_ids()` — the lead AUTHORITY PREDICATE helper: a crew-lead
--                       is a BOUND WORKER, not a role (claim_worker_invite forces
--                       role=contractor), so authority is `current_user_worker_id() =
--                       crews.lead_worker_id`, null-guarded against the spec-131 coalesce trap.
-- Writes go ONLY through the definer RPCs (no direct DML grant); reads are RLS-scoped.
-- ============================================================================

-- ---- crews -----------------------------------------------------------------
create table public.crews (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id),
  name             text not null check (btrim(name) <> '' and length(name) <= 80),
  lead_worker_id   uuid references public.workers (id),
  kind             text not null default 'dc' check (kind in ('dc', 'subcon')),
  default_day_rate numeric(10, 2) check (default_day_rate is null or default_day_rate >= 0),
  active           boolean not null default true,
  created_by       uuid not null references public.users (id),
  created_at       timestamptz not null default now()
);
-- one active crew name per project; deactivated crews free the name for reuse.
create unique index crews_project_name_active_uq on public.crews (project_id, name) where active;
create index crews_project_idx on public.crews (project_id);
create index crews_lead_worker_idx on public.crews (lead_worker_id) where lead_worker_id is not null;

-- ---- crew_members (SSOT, append-only tombstone) ----------------------------
create table public.crew_members (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews (id),
  worker_id  uuid not null references public.workers (id),
  added_by   uuid not null references public.users (id),
  added_at   timestamptz not null default now(),
  removed_at timestamptz
);
-- one active crew per human (a move = tombstone-then-insert).
create unique index crew_members_one_active_per_worker_uq on public.crew_members (worker_id) where removed_at is null;
create index crew_members_crew_active_idx on public.crew_members (crew_id) where removed_at is null;

-- ---- workers.tax_id: firm-wide dedup key (spans active AND inactive) --------
create unique index if not exists workers_tax_id_unique on public.workers (tax_id) where tax_id is not null;

-- ---- RLS -------------------------------------------------------------------
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;

-- Zero-grant baseline; writes only via the definer RPCs below.
revoke all on public.crews from anon, authenticated;
revoke all on public.crew_members from anon, authenticated;
-- Column grant deliberately OMITS default_day_rate (money → zero authenticated
-- grant; read only via the admin client behind a role gate).
grant select (id, project_id, name, lead_worker_id, kind, active, created_by, created_at)
  on public.crews to authenticated;
grant select on public.crew_members to authenticated;

-- The lead-authority helper: the crew ids the caller currently leads. SECURITY
-- DEFINER so it reads crews for the RLS policy without recursion; null-safe so an
-- unbound caller (no bound worker) leads nothing (never opens a gate).
create function public.current_user_led_crew_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select c.id
  from public.crews c
  where c.active
    and c.lead_worker_id is not null
    and public.current_user_worker_id() is not null
    and c.lead_worker_id = public.current_user_worker_id();
$$;
revoke all on function public.current_user_led_crew_ids() from public;
grant execute on function public.current_user_led_crew_ids() to authenticated;

-- crews readable by the onboarding back office OR the crew's own lead (predicate,
-- coalesced to false for unbound callers). No INSERT/UPDATE/DELETE policy → direct
-- DML is denied; the definer RPCs are the only write path.
create policy crews_select on public.crews for select to authenticated
using (
  public.is_back_office(public.current_user_role())
  or coalesce(public.current_user_worker_id() = lead_worker_id, false)
);

-- crew_members readable by the back office OR the lead of that crew.
create policy crew_members_select on public.crew_members for select to authenticated
using (
  public.is_back_office(public.current_user_role())
  or crew_id in (select public.current_user_led_crew_ids())
);

-- ---- create_crew -----------------------------------------------------------
create function public.create_crew(
  p_project uuid,
  p_name text,
  p_lead_worker uuid default null,
  p_kind text default 'dc',
  p_default_day_rate numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_crew_id uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to create a crew' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('dc', 'subcon') then
    raise exception 'invalid crew kind' using errcode = '22023';
  end if;
  if p_lead_worker is not null then
    perform 1 from public.workers w where w.id = p_lead_worker and w.active;
    if not found then
      raise exception 'lead worker not found or inactive' using errcode = 'P0002';
    end if;
  end if;

  insert into public.crews (project_id, name, lead_worker_id, kind, default_day_rate, created_by)
  values (p_project, btrim(p_name), p_lead_worker, p_kind, p_default_day_rate, auth.uid())
  returning id into v_crew_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', v_crew_id,
          jsonb_build_object('op', 'create', 'project_id', p_project, 'name', btrim(p_name),
                             'lead_worker_id', p_lead_worker, 'kind', p_kind));
  return v_crew_id;
end;
$$;
revoke all on function public.create_crew(uuid, text, uuid, text, numeric) from public;
grant execute on function public.create_crew(uuid, text, uuid, text, numeric) to authenticated;

-- ---- reassign_crew_lead ----------------------------------------------------
create function public.reassign_crew_lead(p_crew uuid, p_new_lead uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to reassign a crew lead' using errcode = '42501';
  end if;
  if p_new_lead is not null then
    perform 1 from public.workers w where w.id = p_new_lead and w.active;
    if not found then
      raise exception 'lead worker not found or inactive' using errcode = 'P0002';
    end if;
  end if;

  update public.crews set lead_worker_id = p_new_lead where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'reassign_lead', 'lead_worker_id', p_new_lead));
end;
$$;
revoke all on function public.reassign_crew_lead(uuid, uuid) from public;
grant execute on function public.reassign_crew_lead(uuid, uuid) to authenticated;

comment on table public.crews is
  'Spec 279 / ADR 0079 — a project-scoped crew (ชุด/ทีม) with a named accountable head (lead_worker_id, a bound worker — authority is the current_user_worker_id()=lead_worker_id predicate, NOT a role). kind routes dc vs subcon; default_day_rate is money (zero authenticated grant). Written only via create_crew/reassign_crew_lead.';
comment on table public.crew_members is
  'Spec 279 / ADR 0079 — SSOT of crew membership; append-only tombstone (removed_at). UNIQUE(worker_id) WHERE removed_at IS NULL = one active crew per human. Worker↔crew is derived from here (no denormalised pointer).';
