-- Spec 406 U1 — ผังทักษะรายสายงาน: the skill-map schema core.
--
-- WHY A NEW CRAFT AXIS RATHER THAN `work_categories` (the draft's first ruling,
-- killed by the fact-check): `work_categories` is a WBS PHASE taxonomy. Its 11
-- top-level rows are งานโครงสร้าง / งานสถาปัตยกรรม / งานระบบไฟฟ้า…, and its 43
-- sub-rows are project LINE ITEMS (`W0210 เหล็กโครงสร้าง ROOF GUTTER / SIDING
-- FRAME 1, 2`). The operator's own pilot trades — ช่างเหล็กเสริมคอนกรีต,
-- ช่างไม้ก่อสร้าง — have no row at either level. That is also the best available
-- explanation for `worker_trades` sitting at 0 rows since it shipped: it asked a
-- ช่าง to tag himself with a construction phase, which is not how a craftsman
-- identifies.
--
-- ⛔ `worker_trades` IS DELIBERATELY UNTOUCHED. It FKs the WBS axis, and its
-- writer `set_worker_trades` is PM-admitted (wider than this feature's gate) and
-- does a full `delete … where worker_id = $1` then re-insert — so routing the
-- baseline through it would let a PM silently orphan the level history below.
--
-- WHY LEVELS ARE ROWS AND NOT THE `worker_level` ENUM: Thailand's DSD standard
-- (มาตรฐานฝีมือแรงงานแห่งชาติ) gives ช่างหินขัด exactly ONE level and ช่างก่ออิฐ
-- three, so a fixed four-value enum cannot express the real ladders. The enum and
-- everything wired to it (`worker_level_rates`, `labor_logs.level_snapshot`,
-- `wp_labor_costs`, the Nova dial weights) stays legacy and untouched until S4.
--
-- `reference_day_rate` carries the legally published figure (ประกาศคณะกรรมการ
-- ค่าจ้าง) for DISPLAY ONLY — it writes nothing to payroll. It is seeded, PD-
-- editable data, never a live fetch, because the ประกาศ is reissued.
--
-- Live gate-check (2026-08-08) behind the choices here:
--   * `is_manager(user_role)` = project_manager | super_admin | project_director.
--     Deliberately NOT reused: the operator put map authorship and promotions
--     with the PD tier, so `project_manager` must be refused. Members differ ⇒ a
--     new predicate, not a reused one (the same reasoning that keeps this off
--     CLIENT_ISSUER_ROLES at the code layer).
--   * `current_user_role()` is DEFINER and returns NULL for an unbound caller,
--     so every predicate below coalesces to false rather than opening the gate.
--   * `set_updated_at()` exists and is the house trigger.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.skill_material_kind as enum ('youtube', 'link');

-- Which national standard a trade was seeded from, when it was seeded from one.
-- NULL is a first-class answer: a PRC-specific craft with no national analogue
-- is legitimate and must not be forced to claim one.
create type public.trade_national_source as enum ('dsd', 'tpqi');

create type public.worker_trade_level_kind as enum ('baseline', 'promotion', 'adjustment');

-- ---------------------------------------------------------------------------
-- The authoring gate. IMMUTABLE so policies and CHECKs may use it; coalesced to
-- false so an unbound caller (current_user_role() = NULL) is refused rather than
-- admitted — the RLS self-check trap this repo has been bitten by.
-- ---------------------------------------------------------------------------
create or replace function public.is_skill_map_author(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role in ('project_director', 'super_admin'), false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  code text not null check (btrim(code) <> '' and char_length(code) <= 40),
  name_th text not null check (btrim(name_th) <> '' and char_length(name_th) <= 120),
  national_source public.trade_national_source,
  national_name_th text check (national_name_th is null or char_length(national_name_th) <= 160),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trades_code_unique unique (code)
);

create index trades_active_idx on public.trades (is_active, sort_order);

create table public.trade_levels (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades (id) on delete cascade,
  name_th text not null check (btrim(name_th) <> '' and char_length(name_th) <= 80),
  -- 1 = the bottom rung. Unique per trade among ACTIVE rows (partial index
  -- below), so retiring a level frees its rank for a re-cut ladder.
  rank integer not null check (rank >= 1 and rank <= 20),
  min_hours numeric(10, 2) not null default 0 check (min_hours >= 0),
  -- Display only. See the header: this is reference data, not a payroll input.
  reference_day_rate numeric(10, 2) check (reference_day_rate is null or reference_day_rate >= 0),
  is_active boolean not null default true,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite FK on trade_skills, which is what makes a skill's
  -- denormalised trade_id provably equal to its level's.
  constraint trade_levels_id_trade_unique unique (id, trade_id)
);

create unique index trade_levels_rank_unique
  on public.trade_levels (trade_id, rank) where is_active;
create unique index trade_levels_name_unique
  on public.trade_levels (trade_id, name_th) where is_active;
create index trade_levels_trade_idx on public.trade_levels (trade_id, rank);

create table public.trade_skills (
  id uuid primary key default gen_random_uuid(),
  trade_level_id uuid not null,
  -- Denormalised from the level so a per-trade read needs no join. The composite
  -- FK is what makes that safe: the PAIR is the foreign key, so trade_id cannot
  -- disagree with its level's. A comment promising they agree would not survive
  -- the first writer who forgets.
  trade_id uuid not null references public.trades (id) on delete cascade,
  constraint trade_skills_level_fk foreign key (trade_level_id, trade_id)
    references public.trade_levels (id, trade_id) on delete cascade,
  title_th text not null check (btrim(title_th) <> '' and char_length(title_th) <= 160),
  detail_th text check (detail_th is null or char_length(detail_th) <= 2000),
  -- Each skill declares what proves it. Both may be false: a skill whose only
  -- requirement is the level's hour floor is legitimate.
  requires_mcq boolean not null default false,
  requires_practical boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trade_skills_level_idx on public.trade_skills (trade_level_id, sort_order);
create index trade_skills_trade_idx on public.trade_skills (trade_id);

create table public.skill_materials (
  id uuid primary key default gen_random_uuid(),
  trade_skill_id uuid not null references public.trade_skills (id) on delete cascade,
  kind public.skill_material_kind not null,
  -- Embedded from elsewhere (the operator: "materials can be embedded from other
  -- sources like youtube"), so nothing is hosted here. The scheme check is the
  -- authority; the RPC mirrors it to raise a named refusal instead of 23514.
  url text not null check (url ~ '^https?://' and char_length(url) <= 2000),
  title_th text not null check (btrim(title_th) <> '' and char_length(title_th) <= 160),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index skill_materials_skill_idx on public.skill_materials (trade_skill_id, sort_order);

-- The worker-facing read is a frozen SNAPSHOT, not the live draft, so a PD
-- editing a rubric cannot move requirements under a worker mid-progress. The
-- authoring tables above stay the SSOT of the draft; this is a read artifact and
-- is never edited in place.
create table public.skill_map_publishes (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades (id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  published_by uuid not null references public.users (id),
  published_at timestamptz not null default now(),
  constraint skill_map_publishes_version_unique unique (trade_id, version)
);

create index skill_map_publishes_trade_idx
  on public.skill_map_publishes (trade_id, version desc);

-- Append-only level history. Current level = the latest row per (worker, trade).
-- No UPDATE or DELETE path exists: a correction is a new `adjustment` row, which
-- is why `note_th` is mandatory for that kind (a silent demotion is not an
-- acceptable artifact — the person is owed a stated reason).
create table public.worker_trade_levels (
  id uuid primary key default gen_random_uuid(),
  -- ⚠️ `created_at` CANNOT order this history: `now()` is TRANSACTION time, so
  -- two decisions written in one transaction carry identical timestamps and
  -- "latest" becomes a coin flip on a random uuid. That is not hypothetical —
  -- it produced a silently wrong current-level read the first time this table
  -- was exercised (a promotion that ranked below its own baseline). `seq` is the
  -- total order every "current level" read must use; created_at is for display.
  seq bigint generated always as identity,
  worker_id uuid not null references public.workers (id) on delete cascade,
  trade_id uuid not null references public.trades (id),
  trade_level_id uuid not null,
  constraint worker_trade_levels_level_fk foreign key (trade_level_id, trade_id)
    references public.trade_levels (id, trade_id),
  kind public.worker_trade_level_kind not null,
  note_th text check (note_th is null or char_length(note_th) <= 500),
  constraint worker_trade_levels_adjustment_needs_note
    check (kind <> 'adjustment' or btrim(coalesce(note_th, '')) <> ''),
  decided_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create index worker_trade_levels_worker_idx
  on public.worker_trade_levels (worker_id, trade_id, seq desc);
create index worker_trade_levels_level_idx on public.worker_trade_levels (trade_level_id);

create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();
create trigger trade_levels_set_updated_at
  before update on public.trade_levels
  for each row execute function public.set_updated_at();
create trigger trade_skills_set_updated_at
  before update on public.trade_skills
  for each row execute function public.set_updated_at();
create trigger skill_materials_set_updated_at
  before update on public.skill_materials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants. Reads only; every write goes through the DEFINER RPCs below.
--
-- ⚠️ The REVOKE is load-bearing, not decoration: this project's default
-- privileges hand a brand-new table `arwdDxtm` — EVERY privilege, writes
-- included — to `anon` AND `authenticated`. A table created with `grant select`
-- alone is still directly INSERT/UPDATE/DELETE-able by every signed-in user and
-- readable signed-out, while the migration reads as if it locked the table down.
-- The four posture assertions per table in 406-skill-map.test.sql exist to prove
-- these lines ran.
-- ---------------------------------------------------------------------------
revoke all on public.trades from public, anon, authenticated;
revoke all on public.trade_levels from public, anon, authenticated;
revoke all on public.trade_skills from public, anon, authenticated;
revoke all on public.skill_materials from public, anon, authenticated;
revoke all on public.skill_map_publishes from public, anon, authenticated;
revoke all on public.worker_trade_levels from public, anon, authenticated;

grant select on public.trades to authenticated;
grant select on public.trade_levels to authenticated;
grant select on public.trade_skills to authenticated;
grant select on public.skill_materials to authenticated;
grant select on public.skill_map_publishes to authenticated;
grant select on public.worker_trade_levels to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. The rubric is ORG-LEVEL master data with no project scoping — every
-- worker climbs the same ladder wherever they are posted (ruling 14: everyone in
-- `workers` climbs, DC included), so the read arm is every signed-in user rather
-- than can_see_project. Nothing here is money or PII.
--
-- `worker_trade_levels` is the exception: it is a statement about a PERSON, so it
-- is scoped to the subject themselves plus the authoring tier.
-- ---------------------------------------------------------------------------
alter table public.trades enable row level security;
alter table public.trade_levels enable row level security;
alter table public.trade_skills enable row level security;
alter table public.skill_materials enable row level security;
alter table public.skill_map_publishes enable row level security;
alter table public.worker_trade_levels enable row level security;

-- ⚠️ `(select auth.uid())`, never a bare `auth.uid()`: the subquery form is
-- evaluated ONCE as an initplan instead of per row, and `28-rls-perf` pins the
-- absence of the bare form repo-wide. A drop+create of a policy is a REWRITE, so
-- the wrapper has to be re-applied every time one is touched.
create policy "trades readable by signed-in users"
  on public.trades for select using ((select auth.uid()) is not null);
create policy "trade levels readable by signed-in users"
  on public.trade_levels for select using ((select auth.uid()) is not null);
create policy "trade skills readable by signed-in users"
  on public.trade_skills for select using ((select auth.uid()) is not null);
create policy "skill materials readable by signed-in users"
  on public.skill_materials for select using ((select auth.uid()) is not null);
create policy "skill map publishes readable by signed-in users"
  on public.skill_map_publishes for select using ((select auth.uid()) is not null);

create policy "worker trade levels readable by subject or author"
  on public.worker_trade_levels for select
  using (
    public.is_skill_map_author((select public.current_user_role()))
    or exists (
      select 1 from public.workers w
       where w.id = worker_trade_levels.worker_id
         and w.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs. Gate = is_skill_map_author(current_user_role()) on every one.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_trade(
  p_trade_id uuid,
  p_code text,
  p_name_th text,
  p_national_source public.trade_national_source default null,
  p_national_name_th text default null,
  p_sort_order integer default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'upsert_trade: role not permitted' using errcode = '42501';
  end if;

  if p_trade_id is null then
    insert into public.trades
      (code, name_th, national_source, national_name_th, sort_order, created_by)
    values
      (btrim(p_code), btrim(p_name_th), p_national_source,
       nullif(btrim(coalesce(p_national_name_th, '')), ''),
       coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.trades
       set code = btrim(p_code),
           name_th = btrim(p_name_th),
           national_source = p_national_source,
           national_name_th = nullif(btrim(coalesce(p_national_name_th, '')), ''),
           sort_order = coalesce(p_sort_order, 0)
     where id = p_trade_id
    returning id into v_id;

    if v_id is null then
      raise exception 'upsert_trade: trade not found' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('skill_map_change', auth.uid(), v_role, 'trades', v_id,
          jsonb_build_object('kind', case when p_trade_id is null then 'trade_create'
                                          else 'trade_update' end,
                             'code', btrim(p_code), 'name_th', btrim(p_name_th)));
  return v_id;
end;
$$;

create or replace function public.upsert_trade_level(
  p_level_id uuid,
  p_trade_id uuid,
  p_name_th text,
  p_rank integer,
  p_min_hours numeric default 0,
  p_reference_day_rate numeric default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'upsert_trade_level: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trades where id = p_trade_id) then
    raise exception 'upsert_trade_level: trade not found' using errcode = '22023';
  end if;

  if p_level_id is null then
    insert into public.trade_levels
      (trade_id, name_th, rank, min_hours, reference_day_rate, created_by)
    values
      (p_trade_id, btrim(p_name_th), p_rank, coalesce(p_min_hours, 0),
       p_reference_day_rate, auth.uid())
    returning id into v_id;
  else
    update public.trade_levels
       set name_th = btrim(p_name_th),
           rank = p_rank,
           min_hours = coalesce(p_min_hours, 0),
           reference_day_rate = p_reference_day_rate
     where id = p_level_id and trade_id = p_trade_id
    returning id into v_id;

    if v_id is null then
      raise exception 'upsert_trade_level: level not found on this trade' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('skill_map_change', auth.uid(), v_role, 'trade_levels', v_id,
          jsonb_build_object('kind', case when p_level_id is null then 'level_create'
                                          else 'level_update' end,
                             'trade_id', p_trade_id, 'name_th', btrim(p_name_th),
                             'rank', p_rank, 'min_hours', coalesce(p_min_hours, 0),
                             'reference_day_rate', p_reference_day_rate));
  return v_id;
end;
$$;

-- Deactivate, never delete. A level a worker HOLDS cannot be retired out from
-- under them: the history row would then point at a rung that no longer appears
-- on the ladder, and the worker's own screen would render a level with no name.
-- Re-baseline the holders first — that is a decision someone must make, not a
-- side effect of tidying a rubric.
create or replace function public.retire_trade_level(p_level_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_trade uuid;
  v_holders integer;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'retire_trade_level: role not permitted' using errcode = '42501';
  end if;

  select trade_id into v_trade from public.trade_levels where id = p_level_id;
  if v_trade is null then
    raise exception 'retire_trade_level: level not found' using errcode = '22023';
  end if;

  -- "Holds" means it is the LATEST row for that worker+trade, not merely that it
  -- appears in history — a level someone has already climbed past is retirable.
  -- Ordered by `seq`, never by created_at: see the column's note.
  select count(*) into v_holders
    from public.workers w
   cross join lateral (
     select wtl.trade_level_id
       from public.worker_trade_levels wtl
      where wtl.worker_id = w.id and wtl.trade_id = v_trade
      order by wtl.seq desc
      limit 1
   ) latest
   where latest.trade_level_id = p_level_id;

  if v_holders > 0 then
    raise exception
      'retire_trade_level: % worker(s) currently hold this level — re-baseline them first',
      v_holders using errcode = '22023';
  end if;

  update public.trade_levels set is_active = false where id = p_level_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('skill_map_change', auth.uid(), v_role, 'trade_levels', p_level_id,
          jsonb_build_object('kind', 'level_retire', 'trade_id', v_trade));
end;
$$;

create or replace function public.upsert_trade_skill(
  p_skill_id uuid,
  p_trade_level_id uuid,
  p_title_th text,
  p_detail_th text default null,
  p_requires_mcq boolean default false,
  p_requires_practical boolean default false,
  p_sort_order integer default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_trade uuid;
  v_id uuid;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'upsert_trade_skill: role not permitted' using errcode = '42501';
  end if;

  -- The trade is derived from the LEVEL, never taken from the caller — that is
  -- what makes the denormalised column trustworthy.
  select trade_id into v_trade from public.trade_levels where id = p_trade_level_id;
  if v_trade is null then
    raise exception 'upsert_trade_skill: level not found' using errcode = '22023';
  end if;

  if p_skill_id is null then
    insert into public.trade_skills
      (trade_level_id, trade_id, title_th, detail_th, requires_mcq,
       requires_practical, sort_order, created_by)
    values
      (p_trade_level_id, v_trade, btrim(p_title_th),
       nullif(btrim(coalesce(p_detail_th, '')), ''),
       coalesce(p_requires_mcq, false), coalesce(p_requires_practical, false),
       coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.trade_skills
       set trade_level_id = p_trade_level_id,
           trade_id = v_trade,
           title_th = btrim(p_title_th),
           detail_th = nullif(btrim(coalesce(p_detail_th, '')), ''),
           requires_mcq = coalesce(p_requires_mcq, false),
           requires_practical = coalesce(p_requires_practical, false),
           sort_order = coalesce(p_sort_order, 0)
     where id = p_skill_id
    returning id into v_id;

    if v_id is null then
      raise exception 'upsert_trade_skill: skill not found' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('skill_map_change', auth.uid(), v_role, 'trade_skills', v_id,
          jsonb_build_object('kind', case when p_skill_id is null then 'skill_create'
                                          else 'skill_update' end,
                             'trade_id', v_trade, 'trade_level_id', p_trade_level_id,
                             'title_th', btrim(p_title_th)));
  return v_id;
end;
$$;

create or replace function public.upsert_skill_material(
  p_material_id uuid,
  p_trade_skill_id uuid,
  p_kind public.skill_material_kind,
  p_url text,
  p_title_th text,
  p_sort_order integer default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'upsert_skill_material: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trade_skills where id = p_trade_skill_id) then
    raise exception 'upsert_skill_material: skill not found' using errcode = '22023';
  end if;

  -- Mirrors the CHECK so the caller gets a NAMED cause instead of a bare 23514.
  -- The refusal is built from what is wrong with the value, not from the case
  -- the author had in mind.
  if btrim(coalesce(p_url, '')) !~ '^https?://' then
    raise exception 'upsert_skill_material: the address must start with http:// or https://'
      using errcode = '22023';
  end if;

  if p_material_id is null then
    insert into public.skill_materials
      (trade_skill_id, kind, url, title_th, sort_order, created_by)
    values
      (p_trade_skill_id, p_kind, btrim(p_url), btrim(p_title_th),
       coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.skill_materials
       set trade_skill_id = p_trade_skill_id,
           kind = p_kind,
           url = btrim(p_url),
           title_th = btrim(p_title_th),
           sort_order = coalesce(p_sort_order, 0)
     where id = p_material_id
    returning id into v_id;

    if v_id is null then
      raise exception 'upsert_skill_material: material not found' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('skill_map_change', auth.uid(), v_role, 'skill_materials', v_id,
          jsonb_build_object('kind', case when p_material_id is null then 'material_create'
                                          else 'material_update' end,
                             'trade_skill_id', p_trade_skill_id, 'url', btrim(p_url)));
  return v_id;
end;
$$;

-- Freeze the current draft as the version workers read. Only ACTIVE rows travel:
-- a retired level must stop appearing on the worker's ladder, while the history
-- rows that reference it stay valid.
create or replace function public.publish_skill_map(p_trade_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_version integer;
  v_snapshot jsonb;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'publish_skill_map: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trades where id = p_trade_id) then
    raise exception 'publish_skill_map: trade not found' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.skill_map_publishes where trade_id = p_trade_id;

  select jsonb_build_object(
           'trade', to_jsonb(t) - 'created_by',
           'levels', coalesce((
             select jsonb_agg(lvl order by lvl_rank)
               from (
                 select tl.rank as lvl_rank,
                        jsonb_build_object(
                          'id', tl.id,
                          'name_th', tl.name_th,
                          'rank', tl.rank,
                          'min_hours', tl.min_hours,
                          'reference_day_rate', tl.reference_day_rate,
                          'skills', coalesce((
                            select jsonb_agg(
                                     jsonb_build_object(
                                       'id', ts.id,
                                       'title_th', ts.title_th,
                                       'detail_th', ts.detail_th,
                                       'requires_mcq', ts.requires_mcq,
                                       'requires_practical', ts.requires_practical,
                                       'materials', coalesce((
                                         select jsonb_agg(
                                                  jsonb_build_object(
                                                    'id', sm.id, 'kind', sm.kind,
                                                    'url', sm.url, 'title_th', sm.title_th)
                                                  order by sm.sort_order, sm.created_at)
                                           from public.skill_materials sm
                                          where sm.trade_skill_id = ts.id and sm.is_active
                                       ), '[]'::jsonb))
                                     order by ts.sort_order, ts.created_at)
                              from public.trade_skills ts
                             where ts.trade_level_id = tl.id and ts.is_active
                          ), '[]'::jsonb)
                        ) as lvl
                   from public.trade_levels tl
                  where tl.trade_id = p_trade_id and tl.is_active
               ) ordered
           ), '[]'::jsonb)
         )
    into v_snapshot
    from public.trades t
   where t.id = p_trade_id;

  insert into public.skill_map_publishes (trade_id, version, snapshot, published_by)
  values (p_trade_id, v_version, v_snapshot, auth.uid());

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('skill_map_change', auth.uid(), v_role, 'skill_map_publishes', p_trade_id,
          jsonb_build_object('kind', 'publish', 'version', v_version));
  return v_version;
end;
$$;

-- The ONLY writer of a worker's level. Completion of a rubric RECOMMENDS a
-- promotion; this call is the human decision that enacts it, and once S4 lands it
-- is also the call that moves money — which is why it is PD-gated and audited
-- rather than derived.
create or replace function public.set_worker_trade_level(
  p_worker_id uuid,
  p_trade_id uuid,
  p_trade_level_id uuid,
  p_kind public.worker_trade_level_kind,
  p_note_th text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_level_trade uuid;
  v_active boolean;
  v_id uuid;
begin
  if not public.is_skill_map_author(v_role) then
    raise exception 'set_worker_trade_level: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker_id) then
    raise exception 'set_worker_trade_level: worker not found' using errcode = '22023';
  end if;

  -- The composite FK would also catch this, but a named refusal beats a 23503
  -- the caller has to decode.
  select trade_id, is_active into v_level_trade, v_active
    from public.trade_levels where id = p_trade_level_id;
  if v_level_trade is null then
    raise exception 'set_worker_trade_level: level not found' using errcode = '22023';
  end if;
  if v_level_trade <> p_trade_id then
    raise exception 'set_worker_trade_level: that level belongs to a different trade'
      using errcode = '22023';
  end if;
  if not v_active then
    raise exception 'set_worker_trade_level: that level has been retired'
      using errcode = '22023';
  end if;

  if p_kind = 'adjustment' and btrim(coalesce(p_note_th, '')) = '' then
    raise exception 'set_worker_trade_level: an adjustment must state its reason'
      using errcode = '22023';
  end if;

  insert into public.worker_trade_levels
    (worker_id, trade_id, trade_level_id, kind, note_th, decided_by)
  values
    (p_worker_id, p_trade_id, p_trade_level_id, p_kind,
     nullif(btrim(coalesce(p_note_th, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_trade_level_set', auth.uid(), v_role, 'worker_trade_levels', p_worker_id,
          jsonb_build_object('kind', p_kind, 'trade_id', p_trade_id,
                             'trade_level_id', p_trade_level_id,
                             'note_th', nullif(btrim(coalesce(p_note_th, '')), ''),
                             'event_id', v_id));
  return v_id;
end;
$$;

-- Default EXECUTE reaches PUBLIC, which includes anon — revoke from both, then
-- grant only the signed-in role (the house posture for every DEFINER RPC).
revoke all on function public.upsert_trade(uuid, text, text, public.trade_national_source, text, integer) from public, anon;
revoke all on function public.upsert_trade_level(uuid, uuid, text, integer, numeric, numeric) from public, anon;
revoke all on function public.retire_trade_level(uuid) from public, anon;
revoke all on function public.upsert_trade_skill(uuid, uuid, text, text, boolean, boolean, integer) from public, anon;
revoke all on function public.upsert_skill_material(uuid, uuid, public.skill_material_kind, text, text, integer) from public, anon;
revoke all on function public.publish_skill_map(uuid) from public, anon;
revoke all on function public.set_worker_trade_level(uuid, uuid, uuid, public.worker_trade_level_kind, text) from public, anon;

grant execute on function public.upsert_trade(uuid, text, text, public.trade_national_source, text, integer) to authenticated;
grant execute on function public.upsert_trade_level(uuid, uuid, text, integer, numeric, numeric) to authenticated;
grant execute on function public.retire_trade_level(uuid) to authenticated;
grant execute on function public.upsert_trade_skill(uuid, uuid, text, text, boolean, boolean, integer) to authenticated;
grant execute on function public.upsert_skill_material(uuid, uuid, public.skill_material_kind, text, text, integer) to authenticated;
grant execute on function public.publish_skill_map(uuid) to authenticated;
grant execute on function public.set_worker_trade_level(uuid, uuid, uuid, public.worker_trade_level_kind, text) to authenticated;
