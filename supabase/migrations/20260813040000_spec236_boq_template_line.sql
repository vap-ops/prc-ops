-- Spec 236 — BOQ estimate core (ADR 0066 / S10-U1, decision D6). The FIRST build
-- sub-unit of the S10 estimate/template/bid epic: the estimate GRAIN only —
-- boq_template (firm-wide reusable, D3) + boq_line with RATES on the line
-- (material_rate + labor_rate, D6) + the status enums (D2) + the write RPCs.
--
-- THREE-GRAIN INVARIANT (D6 headline): the catalog item master stays PRICE-FREE
-- (no rate columns), boq_line is PRICED, and supply_plan_lines stays QTY-ONLY.
-- The three concerns — item master (catalog), estimate (boq), execution plan
-- (supply plan) — never bleed into each other. Pinned by pgTAP 245.
--
-- Operator decisions locked (2026-06-30):
--  • D1 — boq_line.catalog_item_id is NULLABLE + a required free-text description.
--    The BuildAll BOQ's lines mostly aren't catalog items (ADR §10.6); the catalog
--    link is optional enrichment, the human label is mandatory.
--  • D2 — status enums boq_line_status (draft/frozen/superseded) +
--    boq_variation_type (standard/added/omitted/provisional_sum) + a nullable
--    exclusivity_group text tag (mutually-exclusive alternate lines, pick-one).
--    These are NEW enum types (created inline — the enum-own-migration rule only
--    applies to ALTER TYPE … ADD VALUE; the `assembly` add is S10-U3, not here).
--  • D3 — boq_template is firm-wide reusable (stable code, deactivate-not-delete
--    via is_active). Instantiation-per-project via a clone is a later unit.
--
-- Posture follows ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO
-- direct write/delete grant, writes ONLY via null-safe SECURITY DEFINER RPCs that
-- set search_path = public, capture the role once, gate NULL-SAFE
-- (v_role IS NULL OR NOT IN (...) → 42501), revoke from public+anon + grant
-- execute to authenticated, NEVER service_role. Role set =
-- project_manager/super_admin/procurement/project_director (the catalog/material-
-- side set per ADR D8 — estimating is procurement-adjacent, matching Relation R /
-- spec 227). Errcodes: 42501 (role), 22023 (bad arg / unknown row), 23505 (dup
-- template code). OUT OF SCOPE (later units): the draft→frozen transition + bid
-- submission + bid-compare (S10-U5); the authoring UI (S10-U2); assemblies
-- (S10-U3/U4); wp_templates.work_category_id (S10-U6).

-- 1. Status enums (D2) -------------------------------------------------------
create type public.boq_line_status as enum ('draft', 'frozen', 'superseded');
create type public.boq_variation_type as enum ('standard', 'added', 'omitted', 'provisional_sum');

-- 2. boq_template — the firm-wide reusable estimate header (D3). Reads =
--    grant-select to authenticated; writes only via the DEFINER RPCs below. No
--    DELETE grant/policy — deactivate via is_active.
create table public.boq_template (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint boq_template_code_not_blank check (length(trim(code)) > 0),
  constraint boq_template_name_not_blank check (length(trim(name)) > 0)
);

create trigger boq_template_set_updated_at
  before update on public.boq_template
  for each row execute function public.set_updated_at();

alter table public.boq_template enable row level security;
revoke all on public.boq_template from anon, authenticated;
grant select on public.boq_template to authenticated;

create policy "boq_template readable by authenticated"
  on public.boq_template for select to authenticated
  using (true);

comment on table public.boq_template is
  'Spec 236 (ADR 0066 D6) — firm-wide reusable BOQ estimate header (D3). Holds boq_line rows. Read to authenticated; written via create/update_boq_template + set_boq_template_active (definer). Deactivate-not-delete via is_active. The estimate grain — distinct from the price-free catalog and the qty-only supply plan.';

-- 3. boq_line — the estimate line. RATES LIVE HERE (D6): material_rate +
--    labor_rate. catalog_item_id is NULLABLE (D1) with a required free-text
--    description. work_category_id reconciles to the global library (D6, nullable).
create table public.boq_line (
  id                uuid primary key default gen_random_uuid(),
  boq_template_id   uuid not null references public.boq_template (id) on delete cascade,
  catalog_item_id   uuid references public.catalog_items (id),
  description       text not null,
  work_category_id  uuid references public.work_categories (id) on delete set null,
  qty               numeric(14, 2) not null,
  unit              text not null,
  material_rate     numeric(14, 2) not null default 0,
  labor_rate        numeric(14, 2) not null default 0,
  is_standard       boolean not null default true,
  variation_type    public.boq_variation_type not null default 'standard',
  line_status       public.boq_line_status not null default 'draft',
  exclusivity_group text,
  sort_order        int not null default 0,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint boq_line_qty_positive check (qty > 0),
  constraint boq_line_material_rate_nonneg check (material_rate >= 0),
  constraint boq_line_labor_rate_nonneg check (labor_rate >= 0),
  constraint boq_line_description_not_blank check (length(trim(description)) > 0),
  constraint boq_line_unit_not_blank check (length(trim(unit)) > 0)
);

create index boq_line_template_idx on public.boq_line (boq_template_id);
create index boq_line_catalog_item_idx on public.boq_line (catalog_item_id);
create index boq_line_work_category_idx on public.boq_line (work_category_id);

create trigger boq_line_set_updated_at
  before update on public.boq_line
  for each row execute function public.set_updated_at();

alter table public.boq_line enable row level security;
revoke all on public.boq_line from anon, authenticated;
grant select on public.boq_line to authenticated;

create policy "boq_line readable by authenticated"
  on public.boq_line for select to authenticated
  using (true);

comment on table public.boq_line is
  'Spec 236 (ADR 0066 D6) — a BOQ estimate line under a boq_template. RATES LIVE HERE (material_rate + labor_rate) — the catalog stays price-free and supply_plan_lines stays qty-only (the three-grain invariant). catalog_item_id NULLABLE + required free-text description (D1). variation_type/line_status enums (D2); new lines default draft (the draft→frozen transition is S10-U5). Read to authenticated; written via add/update/remove_boq_line (definer).';

-- ----------------------------------------------------------------------------
-- 4. Write RPCs (ADR 0066 D8 posture; role = pm/super/procurement/director).
-- ----------------------------------------------------------------------------

create function public.create_boq_template(
  p_code        text,
  p_name        text,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_boq_template: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 60 then
    raise exception 'create_boq_template: code required (<=60)' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'create_boq_template: name required (<=200)' using errcode = '22023';
  end if;

  insert into public.boq_template (code, name, description, created_by)
    values (v_code, v_name, v_desc, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_boq_template(text, text, text) from public, anon;
grant execute on function public.create_boq_template(text, text, text) to authenticated;
comment on function public.create_boq_template(text, text, text) is
  'Spec 236 (ADR 0066 D6) — add a reusable BOQ template (pm/super/procurement/director). Returns the new id. Duplicate code → 23505; blank/oversize code or name → 22023; null/disallowed role → 42501.';

create function public.update_boq_template(
  p_id          uuid,
  p_name        text,
  p_description text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_boq_template: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'update_boq_template: name required (<=200)' using errcode = '22023';
  end if;

  update public.boq_template
     set name = v_name, description = v_desc
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_boq_template: unknown template' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_boq_template(uuid, text, text) from public, anon;
grant execute on function public.update_boq_template(uuid, text, text) to authenticated;
comment on function public.update_boq_template(uuid, text, text) is
  'Spec 236 (ADR 0066 D6) — rename/re-describe a BOQ template by id (pm/super/procurement/director). Unknown id or blank/oversize name → 22023; null/disallowed role → 42501.';

create function public.set_boq_template_active(
  p_id        uuid,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'set_boq_template_active: role not permitted' using errcode = '42501';
  end if;

  update public.boq_template
     set is_active = coalesce(p_is_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_boq_template_active: unknown template' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_boq_template_active(uuid, boolean) from public, anon;
grant execute on function public.set_boq_template_active(uuid, boolean) to authenticated;
comment on function public.set_boq_template_active(uuid, boolean) is
  'Spec 236 (ADR 0066 D6) — (de)activate a BOQ template by id (pm/super/procurement/director). Deactivate-not-delete. Unknown id → 22023; null/disallowed role → 42501.';

-- add_boq_line — append a line to a template. New lines are always draft
-- (line_status is not a param; the draft→frozen transition is S10-U5). qty/rates
-- and the optional catalog-item / work-category FKs are validated for friendly
-- 22023 errors (a raw FK violation would be 23503). Returns the new line id.
create function public.add_boq_line(
  p_boq_template_id   uuid,
  p_description       text,
  p_qty               numeric,
  p_unit              text,
  p_catalog_item_id   uuid                       default null,
  p_work_category_id  uuid                       default null,
  p_material_rate     numeric                    default 0,
  p_labor_rate        numeric                    default 0,
  p_is_standard       boolean                    default true,
  p_variation_type    public.boq_variation_type  default 'standard',
  p_exclusivity_group text                       default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_desc text := btrim(coalesce(p_description, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_excl text := nullif(btrim(coalesce(p_exclusivity_group, '')), '');
  v_mat  numeric := coalesce(p_material_rate, 0);
  v_lab  numeric := coalesce(p_labor_rate, 0);
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'add_boq_line: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.boq_template where id = p_boq_template_id) then
    raise exception 'add_boq_line: unknown template' using errcode = '22023';
  end if;
  if v_desc = '' or length(v_desc) > 500 then
    raise exception 'add_boq_line: description required (<=500)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'add_boq_line: unit required (<=40)' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'add_boq_line: qty must be > 0' using errcode = '22023';
  end if;
  if v_mat < 0 or v_lab < 0 then
    raise exception 'add_boq_line: rates must be >= 0' using errcode = '22023';
  end if;
  if p_catalog_item_id is not null and not exists (
       select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'add_boq_line: unknown catalog item' using errcode = '22023';
  end if;
  if p_work_category_id is not null and not exists (
       select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'add_boq_line: unknown work category' using errcode = '22023';
  end if;

  insert into public.boq_line
      (boq_template_id, catalog_item_id, description, work_category_id, qty, unit,
       material_rate, labor_rate, is_standard, variation_type, exclusivity_group, created_by)
    values
      (p_boq_template_id, p_catalog_item_id, v_desc, p_work_category_id, p_qty, v_unit,
       v_mat, v_lab, coalesce(p_is_standard, true),
       coalesce(p_variation_type, 'standard'), v_excl, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_boq_line(uuid, text, numeric, text, uuid, uuid, numeric, numeric, boolean, public.boq_variation_type, text) from public, anon;
grant execute on function public.add_boq_line(uuid, text, numeric, text, uuid, uuid, numeric, numeric, boolean, public.boq_variation_type, text) to authenticated;
comment on function public.add_boq_line(uuid, text, numeric, text, uuid, uuid, numeric, numeric, boolean, public.boq_variation_type, text) is
  'Spec 236 (ADR 0066 D6) — append a line to a BOQ template (pm/super/procurement/director). Returns the new id. New lines are draft. Unknown template / catalog item / work category, blank description/unit, qty<=0, or negative rate → 22023; null/disallowed role → 42501.';

create function public.update_boq_line(
  p_id                uuid,
  p_description       text,
  p_qty               numeric,
  p_unit              text,
  p_catalog_item_id   uuid                       default null,
  p_work_category_id  uuid                       default null,
  p_material_rate     numeric                    default 0,
  p_labor_rate        numeric                    default 0,
  p_is_standard       boolean                    default true,
  p_variation_type    public.boq_variation_type  default 'standard',
  p_exclusivity_group text                       default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_desc text := btrim(coalesce(p_description, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_excl text := nullif(btrim(coalesce(p_exclusivity_group, '')), '');
  v_mat  numeric := coalesce(p_material_rate, 0);
  v_lab  numeric := coalesce(p_labor_rate, 0);
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_boq_line: role not permitted' using errcode = '42501';
  end if;
  if v_desc = '' or length(v_desc) > 500 then
    raise exception 'update_boq_line: description required (<=500)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'update_boq_line: unit required (<=40)' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'update_boq_line: qty must be > 0' using errcode = '22023';
  end if;
  if v_mat < 0 or v_lab < 0 then
    raise exception 'update_boq_line: rates must be >= 0' using errcode = '22023';
  end if;
  if p_catalog_item_id is not null and not exists (
       select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'update_boq_line: unknown catalog item' using errcode = '22023';
  end if;
  if p_work_category_id is not null and not exists (
       select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'update_boq_line: unknown work category' using errcode = '22023';
  end if;

  -- line_status is NOT edited here (the draft→frozen transition is S10-U5).
  update public.boq_line
     set catalog_item_id   = p_catalog_item_id,
         description       = v_desc,
         work_category_id  = p_work_category_id,
         qty               = p_qty,
         unit              = v_unit,
         material_rate     = v_mat,
         labor_rate        = v_lab,
         is_standard       = coalesce(p_is_standard, true),
         variation_type    = coalesce(p_variation_type, 'standard'),
         exclusivity_group = v_excl
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_boq_line: unknown line' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_boq_line(uuid, text, numeric, text, uuid, uuid, numeric, numeric, boolean, public.boq_variation_type, text) from public, anon;
grant execute on function public.update_boq_line(uuid, text, numeric, text, uuid, uuid, numeric, numeric, boolean, public.boq_variation_type, text) to authenticated;
comment on function public.update_boq_line(uuid, text, numeric, text, uuid, uuid, numeric, numeric, boolean, public.boq_variation_type, text) is
  'Spec 236 (ADR 0066 D6) — edit a BOQ line by id (pm/super/procurement/director); does not change line_status (freeze is S10-U5). Unknown line / catalog item / work category, blank description/unit, qty<=0, or negative rate → 22023; null/disallowed role → 42501.';

create function public.remove_boq_line(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'remove_boq_line: role not permitted' using errcode = '42501';
  end if;

  delete from public.boq_line where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_boq_line: unknown line' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.remove_boq_line(uuid) from public, anon;
grant execute on function public.remove_boq_line(uuid) to authenticated;
comment on function public.remove_boq_line(uuid) is
  'Spec 236 (ADR 0066 D6) — delete a BOQ line by id (pm/super/procurement/director; definer-deletes, no table delete grant). Unknown id → 22023; null/disallowed role → 42501.';
