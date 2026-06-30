-- Spec 226 — Global work_categories library (ADR 0066 / S5, decision D4). Defect
-- C3: per-project free-form work-categories (project_categories, spec 207) don't
-- generalize — no shared bilingual vocabulary, no stable codes, no cross-project
-- reporting, no relation for scoped pickers. D4 adds a firm-wide library ABOVE the
-- per-project taxonomy via a NULLABLE reconcile FK, so per-project freedom AND the
-- locked one-category-per-WP rule (a single FK, spec 207 U2) are both preserved.
--
-- SUBSECTION GRAIN DECISION (S0 open question): FLAT 2-level code, NOT a self-FK
-- parent_code. The spec's own §Schema column list names only code/name_th/name_en/
-- masterformat_code/sort_order/is_active — no parent_code — so the column list
-- implies the flat model. A subsection's parent is derivable by prefix:
-- left(code, 3). Top categories carry a 3-char code (W01..W09); subsections carry a
-- 5-char code (W0101 = W01's first subsection). pgTAP pins that every 5-char code's
-- 3-char prefix resolves to a seeded top category.
--
-- SEED: sourced from the reconciled BuildAll (บ.บิ้วออล) BOQ for project
-- PRC-2026-004 (308 m² Thai Foods Fresh Market store), work axis — 9 top
-- categories W01–W09 + 43 subsections. name_th is the BOQ work-axis label
-- (trimmed, verbatim — operator-editable via update_work_category); name_en is a
-- faithful bilingual translation (defect C3 parity). The BOQ has 44 distinct
-- subsection hints; one (W07 งานป้าย) has no subsection breakdown, so W07 is seeded
-- as a leaf top category (no child rows) → 43 seeded subsections.
--
-- Posture follows ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO
-- direct write/delete grant, writes via null-safe SECURITY DEFINER RPCs. The three
-- firm-wide work-library RPCs are role-gated (pm/super/director, per spec 226 §RPC
-- posture — NOT procurement, matching the WP/project-side already-shipped
-- set_work_package_category); the per-project reconcile RPC additionally
-- membership-gates (can_see_project), because it writes a per-project row and a
-- role-only gate would let a PM of one project reconcile another project's category.

-- 1. public.work_categories — the GLOBAL firm-wide work-category library. A
--    surrogate uuid id PK (the per-project reconcile FK references id, per spec
--    §Schema), plus a stable unique `code` (the bilingual library's display key /
--    flat-grain prefix). Reads = grant-select to authenticated (firm-wide
--    vocabulary, like catalog_categories); writes only via the SECURITY DEFINER
--    RPCs below. No DELETE grant/policy — deactivate via is_active.
create table public.work_categories (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name_th           text not null,
  name_en           text,
  masterformat_code text,
  sort_order        int not null default 0,
  is_active         boolean not null default true,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint work_categories_name_th_not_blank check (length(trim(name_th)) > 0)
);

-- updated_at maintenance via the EXISTING shared trigger function (do not redefine).
create trigger work_categories_set_updated_at
  before update on public.work_categories
  for each row execute function public.set_updated_at();

alter table public.work_categories enable row level security;
revoke all on public.work_categories from anon, authenticated;
grant select on public.work_categories to authenticated;

create policy "work_categories readable by authenticated"
  on public.work_categories for select to authenticated
  using (true);

comment on table public.work_categories is
  'Spec 226 (ADR 0066 D4) — GLOBAL firm-wide work-category library (the WORK axis), bilingual name_th/name_en + stable code + optional masterformat_code. Sits ABOVE the per-project project_categories via project_categories.work_category_id (nullable reconcile FK). Flat 2-level code grain: top category = 3-char code (W01..W09), subsection = 5-char code (W0101); a subsection''s parent is left(code,3). Read to authenticated; written via create/update_work_category + set_work_category_active (definer). Deactivate-not-delete via is_active. Seeded from the reconciled BuildAll BOQ (PRC-2026-004) work axis.';

-- 2. Seed — reconciled BuildAll BOQ (PRC-2026-004) work axis: 9 top categories
--    W01–W09 + 43 subsections (W07 งานป้าย is a leaf, no subsections). name_th =
--    BOQ label (verbatim, trimmed); name_en = faithful translation; sort_order =
--    code-monotonic (top = n*100, sub = n*100+m). on conflict (code) do nothing.
insert into public.work_categories (code, name_th, name_en, sort_order) values
  ('W01', 'งานเตรียมการ & รื้อถอน', 'Preparation & Demolition', 100),
  ('W0101', 'งานทำความสะอาด', 'Cleaning Work', 101),
  ('W0102', 'งานงานปิดล้อมพื้นที่ชั่วคราวขณะก่อสร้าง', 'Temporary Site Enclosure During Construction', 102),
  ('W0103', 'ค่าใช้จ่ายพิเศษตามเงื่อนไข  (ไฟฟ้าถาวร),(ประปาถาวร) ขออนุญาตก่อสร้าง', 'Special Conditional Costs (Permanent Power/Water, Construction Permit)', 103),
  ('W0104', 'หมวดงานเตรียงาน', 'Preparation Works — General', 104),
  ('W0105', 'งานรื้อถอน', 'Demolition Work', 105),
  ('W02', 'งานโครงสร้าง', 'Structural Work', 200),
  ('W0201', 'เสาเข็มตอก', 'Driven Piles', 201),
  ('W0202', 'ฐานราก', 'Footings / Foundations', 202),
  ('W0203', 'ตอม่อและเสา', 'Pedestals & Columns', 203),
  ('W0204', 'คานคอนกรีตคาน', 'Concrete Beams', 204),
  ('W0205', 'งานโครงสร้างพื้น', 'Floor Structure', 205),
  ('W0206', 'เหล็กโครงสร้างเสา', 'Steel Column Structure', 206),
  ('W0207', 'เหล็กโครงสร้างหลังคา', 'Steel Roof Structure', 207),
  ('W0208', 'เหล็กโครงสร้างหลังคา  T3  CANOPY', 'Steel Roof Structure — T3 Canopy', 208),
  ('W0209', 'เหล็กโครงสร้างหลังคา ห้องโหลดสินค้า', 'Steel Roof Structure — Loading Bay', 209),
  ('W0210', 'เหล็กโครงสร้าง  ROOF GUTTER / SIDING FRAME 1 , 2', 'Steel Structure — Roof Gutter / Siding Frame 1,2', 210),
  ('W0211', 'เหล็กโครงสร้าง   SIDING FRAME 3', 'Steel Structure — Siding Frame 3', 211),
  ('W0212', 'เหล็กโครงสร้าง   SIDING FRAME 4  / LINE E', 'Steel Structure — Siding Frame 4 / Line E', 212),
  ('W0213', 'เหล็กโครงสร้าง   SIDING FRAME  ผนังลานโหลดสินค้า', 'Steel Structure — Siding Frame, Loading Yard Wall', 213),
  ('W03', 'งานสถาปัตยกรรม', 'Architectural Work', 300),
  ('W0301', 'งานพื้น', 'Flooring', 301),
  ('W0302', 'งานผนัง', 'Walls', 302),
  ('W0303', 'งานผิวผนัง', 'Wall Finishes', 303),
  ('W0304', 'ประตู', 'Doors', 304),
  ('W0305', 'หน้าต่าง', 'Windows', 305),
  ('W0306', 'งานฝ้าเพดาน', 'Ceilings', 306),
  ('W0307', 'งานหลังคา Metal sheet', 'Roofing — Metal Sheet', 307),
  ('W0308', 'งานสุขภัณฑ์', 'Sanitary Fixtures', 308),
  ('W0309', 'หมวดงานสถาปัตยกรรม', 'Architectural Works — General', 309),
  ('W04', 'งานระบบประปา & สุขาภิบาล', 'Plumbing & Sanitary Systems', 400),
  ('W0401', 'งานสุขาภิบาลน้ำดี', 'Sanitary — Water Supply', 401),
  ('W0402', 'งานสุขาภิบาลน้ำทิ้งภายในอาคาร', 'Sanitary — Indoor Wastewater', 402),
  ('W0403', 'งานสุขาภิบาลน้ำทิ้งภายนอกอาคาร', 'Sanitary — Outdoor Wastewater', 403),
  ('W0404', 'หมวดงานระบบประปาและสุขาภิบาล', 'Plumbing & Sanitary — General', 404),
  ('W05', 'งานระบบไฟฟ้า & สื่อสาร', 'Electrical & Communication Systems', 500),
  ('W0501', 'งานสาย MAIN ( 100 KVA )', 'Main Cabling (100 kVA)', 501),
  ('W0502', 'ตู้ Main Distribution Board ( 250 A )', 'Main Distribution Board (250 A)', 502),
  ('W0503', 'งานเดินท่อร้อยสายไฟ', 'Conduit & Wiring', 503),
  ('W0504', 'ระบบแสงสว่าง โคมไฟฟ้า', 'Lighting System & Luminaires', 504),
  ('W0505', 'ปลั๊กและสวิทซ์ต่างๆ', 'Sockets & Switches', 505),
  ('W0506', 'งานไฟฉุกเฉินและป้ายบอกทางหนีไฟ', 'Emergency Lighting & Exit Signs', 506),
  ('W0507', 'งานสายสื่อสารและระบบกล้องวงจรปิด', 'Communication Cabling & CCTV', 507),
  ('W0508', 'หมวดงานระบบไฟฟ้าและแสงสว่าง', 'Electrical & Lighting — General', 508),
  ('W06', 'งานระบบปรับอากาศ & ระบายอากาศ', 'Air-Conditioning & Ventilation Systems', 600),
  ('W0601', 'เครื่องปรับอากาศ', 'Air-Conditioning Units', 601),
  ('W07', 'งานป้าย', 'Signage Work', 700),
  ('W08', 'งานภายนอก & ผังบริเวณ', 'External Works & Site Layout', 800),
  ('W0801', 'งานถนนและลานจอดรถ', 'Roads & Parking Areas', 801),
  ('W0802', 'หมวดงานภายนอกอาคารและลานจอดรถ', 'External & Parking — General', 802),
  ('W09', 'งานครุภัณฑ์ & งานเพิ่มเติม', 'Furniture/Fixtures & Additional Works', 900),
  ('W0901', 'ตู้สเตนเลสแช่เย็น', 'Stainless Steel Refrigerated Cabinets', 901)
on conflict (code) do nothing;

-- 3. project_categories gains a NULLABLE reconcile FK to the global library. A
--    per-project category MAY be reconciled to a global one, never forced. ON
--    DELETE SET NULL, though work_categories has no delete (deactivate-not-delete),
--    so the action is structurally moot.
alter table public.project_categories
  add column work_category_id uuid null references public.work_categories (id) on delete set null;

create index project_categories_work_category_id_idx
  on public.project_categories (work_category_id);

comment on column public.project_categories.work_category_id is
  'Spec 226 (ADR 0066 D4) — optional reconcile FK to the GLOBAL work_categories library. NULL = un-reconciled (per-project freedom preserved). Set only via set_project_category_work_category.';

-- 4. Material-axis parity (defect C3): catalog_categories gains name_en. The
--    material axis was already global; this gives it the same bilingual label the
--    work axis now carries. Additive nullable — existing readers are unaffected.
alter table public.catalog_categories
  add column name_en text;

comment on column public.catalog_categories.name_en is
  'Spec 226 (ADR 0066 D4) — English name for cross-language parity with the work axis (work_categories.name_en). Additive nullable; the Thai `name` stays the primary label.';

-- ----------------------------------------------------------------------------
-- 5. Write RPCs. ADR 0066 D8 / spec 221 U2 posture: security definer, set
--    search_path, capture the role ONCE, NULL-SAFE gate (v_role IS NULL OR NOT IN
--    (...) → 42501 — an unbound caller is DENIED, not silently allowed), revoke
--    from public+anon + grant execute to authenticated, NEVER service_role.
--    Errcodes: 42501 (role/membership), 22023 (bad arg), 23505 (dup code). The
--    work-library writers are firm-wide role-gated (pm/super/director — per spec
--    226, the WP/project-side role set, NOT procurement). No delete RPC —
--    set_work_category_active deactivates instead.
-- ----------------------------------------------------------------------------

create function public.create_work_category(
  p_code              text,
  p_name_th           text,
  p_name_en           text default null,
  p_masterformat_code text default null,
  p_sort_order        int  default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text := public.current_user_role()::text;
  v_code  text := btrim(coalesce(p_code, ''));
  v_th    text := btrim(coalesce(p_name_th, ''));
  v_en    text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_mf    text := nullif(btrim(coalesce(p_masterformat_code, '')), '');
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_work_category: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 40 then
    raise exception 'create_work_category: code required (<=40)' using errcode = '22023';
  end if;
  if v_th = '' or length(v_th) > 200 then
    raise exception 'create_work_category: name_th required (<=200)' using errcode = '22023';
  end if;

  insert into public.work_categories
      (code, name_th, name_en, masterformat_code, sort_order, created_by)
    values (v_code, v_th, v_en, v_mf, coalesce(p_sort_order, 0), auth.uid());
end;
$$;

revoke all on function public.create_work_category(text, text, text, text, int) from public, anon;
grant execute on function public.create_work_category(text, text, text, text, int) to authenticated;
comment on function public.create_work_category(text, text, text, text, int) is
  'Spec 226 (ADR 0066 D4) — add a global work-category (pm/super/director). Duplicate code → 23505; blank/oversize code or name_th → 22023; null/disallowed role → 42501.';

create function public.update_work_category(
  p_code              text,
  p_name_th           text,
  p_name_en           text default null,
  p_masterformat_code text default null,
  p_sort_order        int  default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_th   text := btrim(coalesce(p_name_th, ''));
  v_en   text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_mf   text := nullif(btrim(coalesce(p_masterformat_code, '')), '');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'project_director') then
    raise exception 'update_work_category: role not permitted' using errcode = '42501';
  end if;
  if v_th = '' or length(v_th) > 200 then
    raise exception 'update_work_category: name_th required (<=200)' using errcode = '22023';
  end if;

  -- code is the stable key (and the flat-grain prefix) — NOT editable here.
  update public.work_categories
     set name_th           = v_th,
         name_en           = v_en,
         masterformat_code = v_mf,
         sort_order        = coalesce(p_sort_order, 0)
   where code = v_code;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_work_category: unknown code' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_work_category(text, text, text, text, int) from public, anon;
grant execute on function public.update_work_category(text, text, text, text, int) to authenticated;
comment on function public.update_work_category(text, text, text, text, int) is
  'Spec 226 (ADR 0066 D4) — edit a global work-category by code (pm/super/director): rename / re-translate / re-anchor / reorder. code is the stable key, not editable. Unknown code or blank/oversize name_th → 22023; null/disallowed role → 42501.';

create function public.set_work_category_active(
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
       ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_category_active: role not permitted' using errcode = '42501';
  end if;

  update public.work_categories
     set is_active = coalesce(p_is_active, true)
   where code = v_code;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_work_category_active: unknown code' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_work_category_active(text, boolean) from public, anon;
grant execute on function public.set_work_category_active(text, boolean) to authenticated;
comment on function public.set_work_category_active(text, boolean) is
  'Spec 226 (ADR 0066 D4) — (de)activate a global work-category by code (pm/super/director). Deactivate-not-delete. Unknown code → 22023; null/disallowed role → 42501.';

-- set_project_category_work_category — reconcile a PER-PROJECT category to a
-- global one. This writes a per-project row, so it role-gates (pm/super/director,
-- null-safe) AND membership-gates (can_see_project) — a role-only gate would let a
-- PM of one project reconcile another project's category. NULL p_work_category_id
-- = un-reconcile (the FK is nullable on purpose). Unknown project category → 22023
-- (bad arg, per spec); unknown work-category → 22023.
create function public.set_project_category_work_category(
  p_project_category_id uuid,
  p_work_category_id    uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_pid  uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_project_category_work_category: role not permitted' using errcode = '42501';
  end if;

  select project_id into v_pid
    from public.project_categories where id = p_project_category_id;
  if not found then
    raise exception 'set_project_category_work_category: unknown project category' using errcode = '22023';
  end if;
  if not (select public.can_see_project(v_pid)) then
    raise exception 'set_project_category_work_category: not a member of this project' using errcode = '42501';
  end if;

  if p_work_category_id is not null and not exists (
       select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'set_project_category_work_category: unknown work category' using errcode = '22023';
  end if;

  update public.project_categories
     set work_category_id = p_work_category_id
   where id = p_project_category_id;
end;
$$;

revoke all on function public.set_project_category_work_category(uuid, uuid) from public, anon;
grant execute on function public.set_project_category_work_category(uuid, uuid) to authenticated;
comment on function public.set_project_category_work_category(uuid, uuid) is
  'Spec 226 (ADR 0066 D4) — reconcile a per-project category to a GLOBAL work-category (pm/super/director, membership-gated via can_see_project). NULL = un-reconcile (per-project freedom preserved). Unknown project category or work-category → 22023; non-member or null/disallowed role → 42501.';
