-- ============================================================================
-- Spec 314 U1 / ADR 0082 — firm-wide level-standard labor rates + WHT compute.
-- Additive. Money columns (entered_rate, wht_pct) get ZERO authenticated grant —
-- service-role read only, like workers.day_rate. The stored/derived rate is GROSS;
-- wht_basis is consumed once, at gross-up time. Writes are PM/super DEFINER-only.
-- ============================================================================

create type public.wht_basis as enum ('before_wht', 'after_wht');

-- ---- worker_level_rates (firm-wide standard, one row per level) -------------
create table public.worker_level_rates (
  level        public.worker_level primary key,
  entered_rate numeric(10, 2) constraint worker_level_rates_rate_nonneg
                 check (entered_rate is null or entered_rate >= 0),
  wht_basis    public.wht_basis not null default 'after_wht',
  active       boolean not null default true,
  updated_by   uuid references public.users (id),
  updated_at   timestamptz not null default now()
);
alter table public.worker_level_rates enable row level security;
-- This DB grants table-level SELECT to authenticated on new public tables via
-- default privileges; revoke it FIRST, then column-grant only the non-money
-- columns, so entered_rate (money) stays unreadable — same posture as workers.day_rate.
revoke all on public.worker_level_rates from anon, authenticated;
grant select (level, wht_basis, active, updated_at) on public.worker_level_rates to authenticated;
create policy worker_level_rates_read on public.worker_level_rates
  for select to authenticated using (true);

-- Seed one row per CURRENT worker_level value; rate NULL (PM fills); basis per
-- operator (2026-07-13): senior/mid gross (before_wht), junior/apprentice net.
insert into public.worker_level_rates (level, wht_basis) values
  ('senior', 'before_wht'), ('mid', 'before_wht'),
  ('junior', 'after_wht'),  ('apprentice', 'after_wht');

comment on table public.worker_level_rates is
  'Spec 314 / ADR 0082 — firm-wide standard day-rate per worker_level, PM-maintained. entered_rate is MONEY (zero authenticated grant); wht_basis says whether the PM typed a before- or after-WHT figure. Written only via set_level_rate.';

-- ---- labor_wht_config (firm-wide WHT %, singleton) -------------------------
create table public.labor_wht_config (
  id         boolean primary key default true constraint labor_wht_config_singleton check (id),
  wht_pct    numeric(5, 2) constraint labor_wht_config_pct_range
               check (wht_pct is null or (wht_pct >= 0 and wht_pct < 100)),
  updated_by uuid references public.users (id),
  updated_at timestamptz not null default now()
);
alter table public.labor_wht_config enable row level security;
-- Money-adjacent: NO authenticated grant → RLS + no policy = service-role only reads.
revoke all on public.labor_wht_config from anon, authenticated;
insert into public.labor_wht_config (id, wht_pct) values (true, 3.00);

comment on table public.labor_wht_config is
  'Spec 314 / ADR 0082 — firm-wide withholding-tax %, single row. wht_pct is money-adjacent (zero authenticated grant); read service-role. Written only via set_labor_wht_pct.';

-- ---- level_gross_rate(level): entered_rate grossed-up per basis + firm % ----
-- Owner/DEFINER-only by design: it returns GROSS (money), so it is NEVER granted to
-- authenticated (that would leak rates). Consumers are DEFINER RPCs (confirm_worker_cost,
-- spec 314 U3) that run as owner; a service-role UI computes gross from the raw money
-- columns it can already read. The firm % is a scalar subselect (not a cross join) so a
-- hypothetically empty config table cannot drop the row.
create function public.level_gross_rate(p_level public.worker_level)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.entered_rate is null then null
    when r.wht_basis = 'before_wht' then r.entered_rate
    else round(r.entered_rate
               / (1 - coalesce((select wht_pct from public.labor_wht_config where id = true), 0) / 100), 2)
  end
  from public.worker_level_rates r
  where r.level = p_level;
$$;
revoke all on function public.level_gross_rate(public.worker_level) from public, anon;

-- ---- set_level_rate (PM/super) ---------------------------------------------
create function public.set_level_rate(
  p_level public.worker_level, p_entered_rate numeric, p_basis public.wht_basis)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('procurement_manager', 'super_admin') then
    raise exception 'set_level_rate: role not permitted' using errcode = '42501';
  end if;
  if p_entered_rate is not null and p_entered_rate < 0 then
    raise exception 'set_level_rate: rate must be >= 0' using errcode = 'P0001';
  end if;
  insert into public.worker_level_rates (level, entered_rate, wht_basis, updated_by, updated_at)
  values (p_level, p_entered_rate, p_basis, auth.uid(), now())
  on conflict (level) do update
    set entered_rate = excluded.entered_rate, wht_basis = excluded.wht_basis,
        updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'worker_level_rates', null,
          jsonb_build_object('op', 'set_level_rate', 'level', p_level,
                             'entered_rate', p_entered_rate, 'basis', p_basis));
end;
$$;
revoke all on function public.set_level_rate(public.worker_level, numeric, public.wht_basis) from public;
revoke execute on function public.set_level_rate(public.worker_level, numeric, public.wht_basis) from anon;
grant execute on function public.set_level_rate(public.worker_level, numeric, public.wht_basis) to authenticated;

-- ---- set_labor_wht_pct (PM/super) ------------------------------------------
create function public.set_labor_wht_pct(p_pct numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('procurement_manager', 'super_admin') then
    raise exception 'set_labor_wht_pct: role not permitted' using errcode = '42501';
  end if;
  if p_pct is not null and (p_pct < 0 or p_pct >= 100) then
    raise exception 'set_labor_wht_pct: pct must be in [0, 100)' using errcode = 'P0001';
  end if;
  update public.labor_wht_config set wht_pct = p_pct, updated_by = auth.uid(), updated_at = now()
   where id = true;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'labor_wht_config', null,
          jsonb_build_object('op', 'set_labor_wht_pct', 'wht_pct', p_pct));
end;
$$;
revoke all on function public.set_labor_wht_pct(numeric) from public;
revoke execute on function public.set_labor_wht_pct(numeric) from anon;
grant execute on function public.set_labor_wht_pct(numeric) to authenticated;
