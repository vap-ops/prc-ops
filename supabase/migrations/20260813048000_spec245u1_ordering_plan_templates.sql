-- Spec 245 U1 — ordering-plan templates: schema foundation.
--
-- A template is a supply_plans row (is_template=true, project_id=null) — the same
-- qty-only/price-free plan entity every project's plan already is, not a new
-- domain. project_id becomes nullable to allow this; a check constraint keeps the
-- two concepts from tangling (a template never carries a project, a normal plan
-- never lacks one).
--
-- RLS: procurement and super_admin/project_director/project_coordinator already
-- read ANY project_id (including null) via can_see_project's existing permissive
-- branches (see 20260750000100 — their branch doesn't reference p_project_id at
-- all) and procurement's own separate cross-project branch. Only project_manager
-- needs a genuinely new, narrow is_template branch (its can_see_project branch
-- requires real membership, impossible against project_id=null).
--
-- RPC fix: add_supply_plan_lines and remove_supply_plan_line both did
-- `select project_id ... if project_id is null then raise 'unknown plan'` — once
-- project_id can legitimately be null (a template), that check can no longer tell
-- "no such row" from "this row is a template" apart. Rewritten to use FOUND (set by
-- SELECT INTO regardless of the selected values) for existence, and is_template to
-- skip the membership check (role check is unchanged). Bodies are the LIVE ones
-- (20260809001000 bulk-add; 20260806000000 remove, re-sourced via 20260809000900's
-- procurement addendum) — only the existence-check + membership-skip lines change.

alter table public.supply_plans
  alter column project_id drop not null;

alter table public.supply_plans
  add column is_template boolean not null default false,
  add column name text;

alter table public.supply_plans
  add constraint supply_plans_template_xor_project check (
    (is_template and project_id is null) or (not is_template and project_id is not null)
  );

comment on column public.supply_plans.is_template is
  'Spec 245 — true for one of the 2 global ordering-plan templates (project_id is null). Normal project plans are always false.';
comment on column public.supply_plans.name is
  'Spec 245 — display name, used only by templates ("TFM 16m"/"TFM 20m"). A normal plan is auto-labeled client-side and leaves this null.';

-- ----------------------------------------------------------------------------
-- RLS — add the narrow project_manager-can-read-templates branch.
-- ----------------------------------------------------------------------------
alter policy "supply_plans readable by project viewers"
  on public.supply_plans
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
    or (is_template and (select public.current_user_role()) in ('project_manager', 'project_director'))
  );

alter policy "supply_plan_lines readable by project viewers"
  on public.supply_plan_lines
  using (
    (select public.current_user_role()) = 'procurement'
    or exists (
      select 1 from public.supply_plans sp
       where sp.id = supply_plan_id
         and (
           public.can_see_project(sp.project_id)
           or (sp.is_template and (select public.current_user_role()) in ('project_manager', 'project_director'))
         )
    )
  );

-- ----------------------------------------------------------------------------
-- add_supply_plan_lines — is_template-aware existence/membership check.
-- ----------------------------------------------------------------------------
create or replace function public.add_supply_plan_lines(p_plan_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_is_template boolean;
  v_line        jsonb;
  v_item        uuid;
  v_wp          uuid;
  v_qty         numeric;
  v_note        text;
  v_count       int := 0;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'add_supply_plan_lines: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.is_template
    into v_project_id, v_status, v_is_template
    from public.supply_plans sp where sp.id = p_plan_id;
  if not found then
    raise exception 'add_supply_plan_lines: unknown plan' using errcode = '22023';
  end if;
  -- Spec 245: a template has no project (no membership to check); every other
  -- plan keeps the existing gate (procurement already skips it, cross-project).
  if not v_is_template
     and public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_lines: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_lines: plan is not editable' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'add_supply_plan_lines: lines must be a json array' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line ->> 'catalog_item_id')::uuid;
    v_wp   := nullif(v_line ->> 'work_package_id', '')::uuid;
    v_qty  := (v_line ->> 'qty')::numeric;
    v_note := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'add_supply_plan_lines: qty must be > 0' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.catalog_items c where c.id = v_item and c.is_active
    ) then
      raise exception 'add_supply_plan_lines: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_wp is not null and not exists (
      select 1 from public.work_packages w
       where w.id = v_wp and w.project_id = v_project_id
    ) then
      raise exception 'add_supply_plan_lines: work package not in this project' using errcode = '22023';
    end if;

    insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
    values (p_plan_id, v_item, v_wp, v_qty, v_note);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.add_supply_plan_lines(uuid, jsonb) is
  'Spec 181/245 — bulk-add plan lines (atomic) to a draft/rejected plan or a template (is_template skips the membership gate; role check unchanged). Returns the count inserted.';

-- ----------------------------------------------------------------------------
-- remove_supply_plan_line — is_template-aware existence/membership check.
-- ----------------------------------------------------------------------------
create or replace function public.remove_supply_plan_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_is_template boolean;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'remove_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.is_template
    into v_project_id, v_status, v_is_template
    from public.supply_plan_lines l
    join public.supply_plans sp on sp.id = l.supply_plan_id
   where l.id = p_line_id;
  if not found then
    raise exception 'remove_supply_plan_line: unknown line' using errcode = '22023';
  end if;
  if not v_is_template
     and public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$$;

comment on function public.remove_supply_plan_line(uuid) is
  'Spec 181/245 — remove a line from a draft/rejected plan or a template (is_template skips the membership gate; role check unchanged).';

-- ----------------------------------------------------------------------------
-- Seed the 2 templates, EMPTY. The operator fills real quantities through the
-- app itself (spec 245 U4, a later unit) — no BOM data guessed here.
-- ----------------------------------------------------------------------------
insert into public.supply_plans (is_template, project_id, name)
values
  (true, null, 'TFM 16m'),
  (true, null, 'TFM 20m');
