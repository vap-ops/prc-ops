-- Spec 223 — Units SSOT (ADR 0066 / S1). The unit-picker vocabulary moves from a
-- TS constant (src/lib/purchasing/units.ts COMMON_UNITS) into a managed, firm-wide
-- table. ADR 0034 sunset AppSheet (the original "AppSheet reads the stored text,
-- code-only list" rationale is gone) and ADR 0066 needs units to carry STRUCTURE
-- (unit_class, a short abbreviation) for the boq_line/scoped pickers — so units join
-- the same managed-table pattern spec 221 used for material categories. Fully
-- ADDITIVE: no existing column/type/RPC signature changes. The stored unit value on
-- consuming rows stays a plain string in S1 (no FK yet — that is a later unit); the
-- free-text escape hatch (UNIT_OTHER_VALUE) survives in the UI.

-- 1. unit_class facet. House rule (CLAUDE.md): classification/status fields are
--    Postgres ENUMS, never free-text — so unit_class is an enum (not a CHECK set),
--    matching how the catalog models its other fixed vocabularies and letting code
--    switch on it type-safely.
create type public.unit_class as enum
  ('count', 'length', 'area', 'volume', 'weight', 'trips');

-- 2. public.catalog_units — the managed unit vocabulary. `code` is BOTH the stable
--    key AND the value persisted on consuming rows (catalog_items.unit, supply-plan
--    lines, …) — so the picker submits `code` and it matches existing stored text.
--    Reads = grant-select to authenticated (firm-wide vocabulary, like
--    catalog_categories); writes only via the SECURITY DEFINER RPCs below. No DELETE
--    grant/policy — deactivate via is_active (masters-no-delete).
create table public.catalog_units (
  code         text primary key,
  display_name text not null,
  abbr_short   text,
  unit_class   public.unit_class not null,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint catalog_units_display_name_not_blank check (length(trim(display_name)) > 0)
);

-- updated_at maintenance via the EXISTING shared trigger function (do not redefine).
create trigger catalog_units_set_updated_at
  before update on public.catalog_units
  for each row execute function public.set_updated_at();

alter table public.catalog_units enable row level security;
revoke all on public.catalog_units from anon, authenticated;
grant select on public.catalog_units to authenticated;

create policy "catalog_units readable by authenticated"
  on public.catalog_units for select to authenticated
  using (true);

comment on table public.catalog_units is
  'Spec 223 (ADR 0066) — managed firm-wide unit vocabulary (reference data; read to authenticated, written via create/update_catalog_unit + set_catalog_unit_active RPCs). code = the stable key AND the unit string stored on consuming rows (plain string, no FK in S1). Seeded from the 25 COMMON_UNITS, each classed. Deactivate-not-delete via is_active.';

-- 3. Seed the 25 COMMON_UNITS (src/lib/purchasing/units.ts), each classed. code =
--    display_name = the Thai unit string (the value already persisted today), so
--    nothing in the vocabulary is lost in the move.
insert into public.catalog_units (code, display_name, unit_class, sort_order) values
  ('ถุง',          'ถุง',          'count',   1),
  ('กระสอบ',       'กระสอบ',       'count',   2),
  ('ก้อน',         'ก้อน',         'count',   3),
  ('แผ่น',         'แผ่น',         'count',   4),
  ('เส้น',         'เส้น',         'count',   5),
  ('ท่อน',         'ท่อน',         'count',   6),
  ('ม้วน',         'ม้วน',         'count',   7),
  ('มัด',          'มัด',          'count',   8),
  ('กล่อง',        'กล่อง',        'count',   9),
  ('ชุด',          'ชุด',          'count',  10),
  ('ตัว',          'ตัว',          'count',  11),
  ('อัน',          'อัน',          'count',  12),
  ('ชิ้น',         'ชิ้น',         'count',  13),
  ('ใบ',           'ใบ',           'count',  14),
  ('ถัง',          'ถัง',          'count',  15),
  ('แกลลอน',       'แกลลอน',       'volume', 16),
  ('กระป๋อง',      'กระป๋อง',      'count',  17),
  ('เมตร',         'เมตร',         'length', 18),
  ('ตารางเมตร',    'ตารางเมตร',    'area',   19),
  ('ลูกบาศก์เมตร', 'ลูกบาศก์เมตร', 'volume', 20),
  ('คิว',          'คิว',          'volume', 21),
  ('กิโลกรัม',     'กิโลกรัม',     'weight', 22),
  ('ตัน',          'ตัน',          'weight', 23),
  ('ลิตร',         'ลิตร',         'volume', 24),
  ('เที่ยว',       'เที่ยว',       'trips',  25)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Write RPCs (back-office: pm / super / procurement / director). Mirrors the
--    spec 221 U2 / ADR 0066 D8 posture: security definer, set search_path,
--    capture the role ONCE, NULL-SAFE gate (v_role IS NULL OR NOT IN (...) →
--    42501 — an unbound caller must be DENIED, not silently allowed), revoke from
--    public+anon + grant execute to authenticated, NEVER service_role. Errcodes:
--    42501 (role), 22023 (bad arg), 23505 (duplicate code). No delete RPC —
--    set_catalog_unit_active deactivates instead.
-- ----------------------------------------------------------------------------

create function public.create_catalog_unit(
  p_code         text,
  p_display_name text,
  p_abbr_short   text default null,
  p_unit_class   public.unit_class default 'count',
  p_sort_order   int default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_abbr text := nullif(btrim(coalesce(p_abbr_short, '')), '');
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_unit: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 40 then
    raise exception 'create_catalog_unit: code required (<=40)' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_unit: display_name required (<=120)' using errcode = '22023';
  end if;
  if v_abbr is not null and length(v_abbr) > 40 then
    raise exception 'create_catalog_unit: abbr_short too long (<=40)' using errcode = '22023';
  end if;

  insert into public.catalog_units
      (code, display_name, abbr_short, unit_class, sort_order, created_by)
    values (v_code, v_name, v_abbr, p_unit_class, coalesce(p_sort_order, 0), auth.uid());
end;
$$;

revoke all on function public.create_catalog_unit(text, text, text, public.unit_class, int) from public, anon;
grant execute on function public.create_catalog_unit(text, text, text, public.unit_class, int) to authenticated;
comment on function public.create_catalog_unit(text, text, text, public.unit_class, int) is
  'Spec 223 (ADR 0066) — add a managed unit (back-office: pm/super/procurement/director). code is the stable key + the stored value (unique → 23505); blank/oversize arg → 22023; null/disallowed role → 42501.';

create function public.update_catalog_unit(
  p_code         text,
  p_display_name text,
  p_abbr_short   text default null,
  p_unit_class   public.unit_class default 'count',
  p_sort_order   int default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_abbr text := nullif(btrim(coalesce(p_abbr_short, '')), '');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_catalog_unit: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_catalog_unit: display_name required (<=120)' using errcode = '22023';
  end if;
  if v_abbr is not null and length(v_abbr) > 40 then
    raise exception 'update_catalog_unit: abbr_short too long (<=40)' using errcode = '22023';
  end if;

  -- code is the stored value on consuming rows — NOT editable here (recoding would
  -- orphan stored references). The row is identified by code; the editable fields
  -- are display_name / abbr_short / unit_class / sort_order.
  update public.catalog_units
     set display_name = v_name,
         abbr_short   = v_abbr,
         unit_class   = p_unit_class,
         sort_order   = coalesce(p_sort_order, 0)
   where code = v_code;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_unit: unknown code' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_catalog_unit(text, text, text, public.unit_class, int) from public, anon;
grant execute on function public.update_catalog_unit(text, text, text, public.unit_class, int) to authenticated;
comment on function public.update_catalog_unit(text, text, text, public.unit_class, int) is
  'Spec 223 (ADR 0066) — edit a managed unit by code (back-office): rename / re-abbreviate / reclass / reorder. code is the stored value, not editable. Unknown code → 22023; blank/oversize arg → 22023; null/disallowed role → 42501.';

create function public.set_catalog_unit_active(
  p_code      text,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'set_catalog_unit_active: role not permitted' using errcode = '42501';
  end if;

  update public.catalog_units
     set is_active = coalesce(p_is_active, true)
   where code = v_code;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_catalog_unit_active: unknown code' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_catalog_unit_active(text, boolean) from public, anon;
grant execute on function public.set_catalog_unit_active(text, boolean) to authenticated;
comment on function public.set_catalog_unit_active(text, boolean) is
  'Spec 223 (ADR 0066) — (de)activate a managed unit by code (back-office). Deactivate-not-delete. Unknown code → 22023; null/disallowed role → 42501.';
