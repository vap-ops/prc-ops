-- Spec 270 U1 / ADR 0074 — two-level work packages: งาน (group) + งานย่อย (leaf).
-- Additive only. Same-table hierarchy: parent_id self-FK + is_group, depth exactly 2.
-- Group rows: status DERIVED from children (rollup trigger; manual writes rejected at
-- pg_trigger_depth() < 2), priority immutable, and every photo/money/member/dependency
-- binding table rejects group WPs via one generic trigger fn. Existing rows are
-- untouched (is_group=false, parent_id NULL) — the grouping-mandatory CHECK ships in a
-- later migration AFTER the one-time import assigns parents (spec 270 §2 D6).

alter table public.work_packages
  add column is_group boolean not null default false,
  add column parent_id uuid references public.work_packages(id);

create index work_packages_parent_id_idx
  on public.work_packages (parent_id) where parent_id is not null;

-- ---------------------------------------------------------------------------
-- Hierarchy + group-write guard (BEFORE INSERT/UPDATE on work_packages).
-- SECURITY DEFINER so the parent lookup is not blinded by the caller's RLS;
-- trigger-returning fns are not callable through the API.
-- ---------------------------------------------------------------------------
create or replace function public.wp_hierarchy_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  par record;
begin
  if tg_op = 'UPDATE' and new.is_group is distinct from old.is_group then
    raise exception 'is_group is immutable (WP %)', new.id using errcode = '23514';
  end if;

  if new.is_group and new.parent_id is not null then
    raise exception 'a group (งาน) cannot have a parent — depth is capped at 2 (WP %)', new.id
      using errcode = '23514';
  end if;

  if new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    select id, is_group, project_id into par
      from public.work_packages where id = new.parent_id;
    if found then
      if not par.is_group then
        raise exception 'parent % is a งานย่อย — a parent must be a group (งาน)', new.parent_id
          using errcode = '23514';
      end if;
      if par.project_id <> new.project_id then
        raise exception 'parent % belongs to another project', new.parent_id
          using errcode = '23514';
      end if;
    end if; -- unknown id falls through to the FK error
  end if;

  if new.is_group then
    if tg_op = 'INSERT' and new.status <> 'not_started' then
      raise exception 'a group (งาน) must start not_started — its status is derived'
        using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status
       and pg_trigger_depth() < 2 then
      raise exception 'group (งาน) status is derived from its งานย่อย — not hand-editable (WP %)', new.id
        using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.priority is distinct from old.priority then
      raise exception 'group (งาน) priority is not editable (WP %)', new.id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger work_packages_hierarchy_guard
  before insert or update on public.work_packages
  for each row execute function public.wp_hierarchy_guard();

-- ---------------------------------------------------------------------------
-- Status rollup (AFTER row change on leaves → recompute affected parents).
-- Truth table (spec 270 §3): empty→not_started · all complete→complete ·
-- all not_started→not_started · all on_hold→on_hold · else in_progress.
-- The parent update runs at pg_trigger_depth() >= 1, so its own BEFORE guard
-- (which rejects manual writes at depth < 2) lets it through. Parents have
-- parent_id NULL, so their own update never re-enters the rollup.
-- ---------------------------------------------------------------------------
create or replace function public.wp_rollup_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_status public.work_package_status;
begin
  for v_parent in
    select p from (values
      (case when tg_op in ('INSERT', 'UPDATE') then new.parent_id end),
      (case when tg_op in ('DELETE', 'UPDATE') then old.parent_id end)
    ) as t(p)
    where p is not null
    group by p
  loop
    select case
        when count(*) = 0 then 'not_started'
        when count(*) = count(*) filter (where status = 'complete') then 'complete'
        when count(*) = count(*) filter (where status = 'not_started') then 'not_started'
        when count(*) = count(*) filter (where status = 'on_hold') then 'on_hold'
        else 'in_progress'
      end::public.work_package_status
      into v_status
      from public.work_packages
      where parent_id = v_parent;

    update public.work_packages
      set status = v_status
      where id = v_parent and status is distinct from v_status;
  end loop;

  return null;
end;
$$;

create trigger work_packages_rollup_status
  after insert or delete or update of status, parent_id on public.work_packages
  for each row execute function public.wp_rollup_status();

-- ---------------------------------------------------------------------------
-- Generic group-binding reject: no photo/money/member/dependency row may point
-- at a group (งาน). Column names arrive via TG_ARGV so one fn covers all
-- tables, including the two-column dependencies table.
-- ---------------------------------------------------------------------------
create or replace function public.wp_reject_group_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text;
  v_wp uuid;
begin
  foreach v_col in array tg_argv loop
    v_wp := (to_jsonb(new) ->> v_col)::uuid;
    if v_wp is not null
       and coalesce((select is_group from public.work_packages where id = v_wp), false) then
      raise exception '% must bind a งานย่อย — WP % is a group (งาน)', tg_table_name, v_wp
        using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create trigger approvals_reject_group_wp
  before insert or update on public.approvals
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger equipment_usage_logs_reject_group_wp
  before insert or update on public.equipment_usage_logs
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger journal_lines_reject_group_wp
  before insert or update on public.journal_lines
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger labor_logs_reject_group_wp
  before insert or update on public.labor_logs
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger photo_logs_reject_group_wp
  before insert on public.photo_logs
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger purchase_requests_reject_group_wp
  before insert or update on public.purchase_requests
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger stock_issues_reject_group_wp
  before insert on public.stock_issues
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger stock_returns_reject_group_wp
  before insert on public.stock_returns
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger subcontract_wps_reject_group_wp
  before insert or update on public.subcontract_wps
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger supply_plan_lines_reject_group_wp
  before insert or update on public.supply_plan_lines
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger work_package_members_reject_group_wp
  before insert or update on public.work_package_members
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger wp_economics_reject_group_wp
  before insert or update on public.wp_economics
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger wp_labor_costs_reject_group_wp
  before insert or update on public.wp_labor_costs
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger wp_profit_bank_reject_group_wp
  before insert or update on public.wp_profit_bank
  for each row execute function public.wp_reject_group_binding('work_package_id');
create trigger work_package_dependencies_reject_group_wp
  before insert or update on public.work_package_dependencies
  for each row execute function public.wp_reject_group_binding('predecessor_id', 'successor_id');
