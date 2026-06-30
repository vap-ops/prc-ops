-- Spec 227 — Relation R: work_category_material_categories bridge (ADR 0066 / S6,
-- decision D5). The work axis (work_categories, spec 226) and the material axis
-- (catalog_categories, spec 221) are both modeled but NOTHING connects them — so a
-- scoped picker (specs 228/229) can't know which material-categories a work-category
-- typically buys. This additive many-to-many bridge, on the GLOBAL library, declares
-- "this work-category buys materials from these material-categories (optionally
-- narrowed by kind_filter)". It lives global (not per-project) so every project's
-- reconciled work-category benefits from one shared mapping.
--
-- SEED GRAIN DECISION: W-TOP grain (work_categories.code length 3 — W01..W09), NOT
-- the W0101-style subsections. Rationale: the BuildAll BOQ items are not loaded into
-- catalog_items (different grain — ADR 0066 §10.6), so a per-item material-category
-- join is unavailable; the honest, reproducible signal is "which material-categories
-- does a TOP work-category's BOQ items fall under". The resolver does a DIRECT lookup
-- (work_category_id -> its rows); a WP reconciled to a SUBSECTION (5-char code)
-- resolves empty and the picker shows-all (ADR 0066 D8 fallback). Subsection-grain
-- rows / prefix-climbing are a future unit, out of scope here.
--
-- SEED SOURCE: reconciled BuildAll (บ.บิ้วออล) BOQ for project PRC-2026-004 (308 m²
-- Thai Foods Fresh Market store), work axis (boq_work_axis.csv) cross-read against
-- the 13 managed catalog_categories. 8 of 9 top categories map (19 pairs). W07 ป้าย
-- (signage: vinyl/stainless sign boxes) is INTENTIONALLY UNSEEDED — no material
-- category among the 13 fits — and exercises the empty-Relation-R show-all fallback
-- the pickers depend on (the adoption-cliff caveat, ADR 0066 §10.1).
--
-- NULL kind_filter is "no kind filter" (the relation covers all kinds of that
-- category). All seed rows carry NULL kind_filter (no kind narrowing in v1). The
-- unique index coalesces (kind_filter)::text to '' so a NULL-kind row and a typed
-- row for the same (work, category) are DISTINCT, while two NULL-kind rows collide.
--
-- Posture follows ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO
-- direct write/delete grant, all writes through null-safe SECURITY DEFINER RPCs.
-- The bridge is on the catalog/material side, so the writer roles are the 4-role set
-- pm/super/procurement/director (INCLUDES procurement — Relation R is firm-wide
-- material curation, unlike the WP-side work-library writers in spec 226).

create table public.work_category_material_categories (
  id               uuid primary key default gen_random_uuid(),
  work_category_id uuid not null references public.work_categories (id) on delete cascade,
  category_id      uuid not null references public.catalog_categories (id) on delete cascade,
  kind_filter      catalog_item_kind,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

-- Block duplicate relation rows. A PARTIAL INDEX PAIR handles the NULL (an enum::text
-- cast is only STABLE, not IMMUTABLE, so a coalesce-in-index expression is rejected):
--   * typed-kind rows are unique on (work_category_id, category_id, kind_filter)
--   * NULL-kind rows are unique on (work_category_id, category_id)
-- Together: a NULL-kind row and a typed-kind row for the same (work, category) stay
-- DISTINCT, while two NULL-kind rows (the common seed grain) — or two identical
-- typed-kind rows — collide (23505). (A plain unique would treat the NULLs as distinct
-- and admit duplicate NULL-kind rows.)
create unique index work_category_material_categories_kind_uniq
  on public.work_category_material_categories (work_category_id, category_id, kind_filter)
  where kind_filter is not null;
create unique index work_category_material_categories_nokind_uniq
  on public.work_category_material_categories (work_category_id, category_id)
  where kind_filter is null;

alter table public.work_category_material_categories enable row level security;
revoke all on public.work_category_material_categories from anon, authenticated;
grant select on public.work_category_material_categories to authenticated;

create policy "work_category_material_categories readable by authenticated"
  on public.work_category_material_categories for select to authenticated
  using (true);

comment on table public.work_category_material_categories is
  'Spec 227 (ADR 0066 D5) — Relation R: the GLOBAL work<->material bridge. Declares which material-categories (catalog_categories) a work-category (work_categories) typically buys, optionally narrowed by kind_filter (NULL = all kinds). Powers the scoped pickers (specs 228/229): given a WP''s reconciled work-category, the picker pre-filters/reorders the catalog to the related material-categories (shows ALL by default; empty relation -> full catalog). Seeded W-TOP grain from the BuildAll BOQ (PRC-2026-004); W07 signage intentionally unseeded. Read to authenticated; written via add_/remove_work_category_material_category (definer). Uniqueness via a partial-index pair: typed-kind rows unique on (work_category_id, category_id, kind_filter); NULL-kind rows unique on (work_category_id, category_id).';

-- Seed — BOQ-derived work->material mappings, W-TOP grain. Looked up by stable code
-- (no hard-coded uuids), so it is reproducible and resilient to id regeneration.
-- on conflict do nothing (idempotent; never overwrites operator edits).
insert into public.work_category_material_categories (work_category_id, category_id, kind_filter)
select wc.id, cc.id, null::catalog_item_kind
from (values
  -- W01 เตรียมการ & รื้อถอน: steel fences/gates/guard-posts; site enclosure/camp/clearing
  ('W01','01'), ('W01','03'),
  -- W02 โครงสร้าง: rebar + structural steel + ties/plates; rust-proofing paint
  ('W02','01'), ('W02','08'),
  -- W03 สถาปัตยกรรม: sanitary fixtures; metal-sheet roof/gutter; tiles+ceiling; doors/windows; ext paint
  ('W03','02'), ('W03','04'), ('W03','05'), ('W03','07'), ('W03','08'),
  -- W04 ประปา & สุขาภิบาล: PVC pipe/valves/taps/COTTO; water + septic tanks
  ('W04','02'), ('W04','12'),
  -- W05 ไฟฟ้า & สื่อสาร: cables/breakers/luminaires/conduit
  ('W05','06'),
  -- W06 ปรับอากาศ: steel mounting frames + rust paint (AC units = equipment, no category)
  ('W06','01'), ('W06','08'),
  -- W07 ป้าย: INTENTIONALLY UNSEEDED — no material category fits (empty-fallback anchor)
  -- W08 ภายนอก & ผังบริเวณ: steel bollards/poles + mesh; drainage pipe; parking lighting; line paint
  ('W08','01'), ('W08','02'), ('W08','06'), ('W08','08'),
  -- W09 ครุภัณฑ์: steel basket-stands / stainless tables (rest = owner-supplied equipment)
  ('W09','01')
) as m(w_code, c_code)
join public.work_categories   wc on wc.code = m.w_code
join public.catalog_categories cc on cc.code = m.c_code
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Write RPCs. ADR 0066 D8 / spec 221 U2: security definer, set search_path,
-- capture the role ONCE, NULL-SAFE gate (v_role IS NULL OR NOT IN (...) -> 42501 —
-- an unbound caller is DENIED, not silently allowed), revoke from public+anon +
-- grant execute to authenticated, NEVER service_role. The bridge is on the material
-- side, so the writer set is the 4-role pm/super/procurement/director. Errcodes:
-- 42501 (role), 22023 (bad arg / unknown work-cat or category), 23505 (duplicate).
-- ----------------------------------------------------------------------------

create function public.add_work_category_material_category(
  p_work_category_id uuid,
  p_category_id      uuid,
  p_kind_filter      catalog_item_kind default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'add_work_category_material_category: role not permitted' using errcode = '42501';
  end if;
  if p_work_category_id is null or p_category_id is null then
    raise exception 'add_work_category_material_category: work-category and category required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.work_categories where id = p_work_category_id) then
    raise exception 'add_work_category_material_category: unknown work-category' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_categories where id = p_category_id) then
    raise exception 'add_work_category_material_category: unknown category' using errcode = '22023';
  end if;

  insert into public.work_category_material_categories
      (work_category_id, category_id, kind_filter, created_by)
    values (p_work_category_id, p_category_id, p_kind_filter, auth.uid())
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_work_category_material_category(uuid, uuid, catalog_item_kind) from public, anon;
grant execute on function public.add_work_category_material_category(uuid, uuid, catalog_item_kind) to authenticated;
comment on function public.add_work_category_material_category(uuid, uuid, catalog_item_kind) is
  'Spec 227 (ADR 0066 D5) — add a work->material relation (pm/super/procurement/director). NULL p_kind_filter = no kind filter. Duplicate relation -> 23505; null/unknown work-category or category -> 22023; null/disallowed role -> 42501. Returns the new relation id.';

create function public.remove_work_category_material_category(
  p_work_category_id uuid,
  p_category_id      uuid,
  p_kind_filter      catalog_item_kind default null
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
    raise exception 'remove_work_category_material_category: role not permitted' using errcode = '42501';
  end if;

  -- Match the same coalesce-text NULL handling the uniqueness index uses, so a
  -- NULL-kind arg targets exactly the NULL-kind row (not a typed-kind sibling).
  delete from public.work_category_material_categories
   where work_category_id = p_work_category_id
     and category_id = p_category_id
     and coalesce((kind_filter)::text, '') = coalesce((p_kind_filter)::text, '');

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_work_category_material_category: unknown relation' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.remove_work_category_material_category(uuid, uuid, catalog_item_kind) from public, anon;
grant execute on function public.remove_work_category_material_category(uuid, uuid, catalog_item_kind) to authenticated;
comment on function public.remove_work_category_material_category(uuid, uuid, catalog_item_kind) is
  'Spec 227 (ADR 0066 D5) — remove a work->material relation (pm/super/procurement/director). NULL p_kind_filter targets the NULL-kind row. Unknown relation -> 22023; null/disallowed role -> 42501.';
