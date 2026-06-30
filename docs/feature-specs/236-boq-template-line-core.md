# Spec 236 — BOQ estimate core: `boq_template` + `boq_line` + write RPCs (ADR 0066 / S10-U1)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D6**. Parent epic: [231 — estimate/template/bid layer](231-estimate-template-bid-layer.md)
(§Decomposition note (a)). **Session S10-U1.** **Autonomy: 🔔 ONE-TAP HOLD** (schema migration =
danger-path). Schema lane, reserved migration ts **`20260813040000`** (true max on `main` = `039000`).

This is the **first** build sub-unit of the S10 epic: the estimate **grain** (tables + status enums +
write RPCs). It deliberately ships **only the schema core** — the estimate authoring UI is S10-U2,
assemblies are S10-U3/U4, bid submission + the freeze/compare flow are S10-U5.

## Operator decisions locked (2026-06-30, this build's input)

- **D1 — `boq_line` grain:** `catalog_item_id` is **NULLABLE** + a **required free-text
  `description`**. The BuildAll BOQ's lines mostly aren't catalog items (different grain, ADR §10.6);
  the catalog link is an optional enrichment, the human-readable description is mandatory.
- **D2 — status enums:** `boq_line_status` = `draft | frozen | superseded`; `boq_variation_type` =
  `standard | added | omitted | provisional_sum`; `exclusivity_group` = a **nullable text tag**
  grouping mutually-exclusive alternate lines (pick-one). These are **new `CREATE TYPE` enums**
  (created inline with the tables — the enum-own-migration rule only applies to `ALTER TYPE … ADD
VALUE`; the `assembly` add to `catalog_item_kind` is S10-U3, not here).
- **D3 — `boq_template` scope:** **firm-wide reusable** (a stable `code`, deactivate-not-delete via
  `is_active`), instantiated per project via a clone in a later unit. U1 ships the reusable header +
  its CRUD; the clone/instantiate flow is **not** in U1.

## Acceptance criteria / Definition of Done (test-first)

1. **`boq_template`** exists: `id` uuid PK, stable unique `code`, `name`, `description`, `is_active`,
   `sort_order`, `created_by`, `created_at`, `updated_at` (shared `set_updated_at` trigger). RLS
   enabled; **grant SELECT to authenticated** (firm-wide library, spec 221 U2 / D8 posture); **no
   direct write/delete grant**; **no DELETE** (deactivate via `is_active`).
2. **`boq_line`** exists with **rates on the line** (D6):
   `id` PK · `boq_template_id` → `boq_template(id)` **ON DELETE CASCADE** · `catalog_item_id` →
   `catalog_items(id)` **NULLABLE** (D1) · `description text not null` (blank-check, D1) ·
   `work_category_id` → `work_categories(id)` **nullable** ON DELETE SET NULL (D6) · `qty
numeric(14,2) not null` (`qty > 0`) · `unit text not null` · `material_rate numeric(14,2) not
null default 0` (`>= 0`) · `labor_rate numeric(14,2) not null default 0` (`>= 0`) · `is_standard
boolean not null default true` · `variation_type boq_variation_type not null default 'standard'`
   · `line_status boq_line_status not null default 'draft'` · `exclusivity_group text` (nullable) ·
   `sort_order` · `created_by`/`created_at`/`updated_at`. Same RLS/grant posture as `boq_template`.
3. **The three-grain invariant is pgTAP-pinned (D6 headline):** `boq_line` **has** `material_rate` +
   `labor_rate` (estimate is priced); **`catalog_items` has neither** (catalog stays price-free);
   **`supply_plan_lines` has neither** and keeps `qty` (execution plan stays qty-only).
4. **Write RPCs** (all SECURITY DEFINER, `set search_path = public`, role captured once, **null-safe
   gate** `v_role is null or v_role not in (...)` → `42501`, `revoke … from public, anon` + `grant
execute … to authenticated`, never `service_role`): role set =
   **`project_manager`/`super_admin`/`procurement`/`project_director`** (the catalog/material-side
   set per ADR D8 — estimating is procurement-adjacent, matching Relation R / spec 227):
   - `create_boq_template(p_code, p_name, p_description default null)` → `uuid` (the new id). Dup
     `code` → `23505`; blank `code`/`name` → `22023`.
   - `update_boq_template(p_id, p_name, p_description default null)` → void. Unknown id → `22023`.
   - `set_boq_template_active(p_id, p_is_active)` → void. Unknown id → `22023`. (deactivate-not-delete)
   - `add_boq_line(p_boq_template_id, p_description, p_qty, p_unit, p_catalog_item_id default null,
p_work_category_id default null, p_material_rate default 0, p_labor_rate default 0,
p_is_standard default true, p_variation_type default 'standard', p_exclusivity_group default
null)` → `uuid`. New lines are always `line_status = 'draft'`. Unknown template / unknown
     catalog item / unknown work-category / blank description / `qty <= 0` / negative rate → `22023`.
   - `update_boq_line(p_id, p_description, p_qty, p_unit, p_catalog_item_id default null,
p_work_category_id default null, p_material_rate default 0, p_labor_rate default 0,
p_is_standard default true, p_variation_type default 'standard', p_exclusivity_group default
null)` → void. Unknown id → `22023`; same arg validation.
   - `remove_boq_line(p_id)` → void (definer deletes; no delete grant to authenticated). Unknown id
     → `22023`.
5. Errcodes: `42501` (null/disallowed role), `22023` (bad arg / unknown row), `23505` (dup template
   code). Enum args are enum-typed (invalid value rejected at the cast boundary, `22P02`).

## Out of scope (later S10 units)

- The **freeze** transition (`draft → frozen`) + bid submission + bid-compare view — **S10-U5**. U1
  ships the `line_status` column + enum; nothing in U1 drives it past the `draft` default.
- The estimate **authoring UI** — S10-U2. U1 is schema + RPCs only.
- **Assemblies** (`kind = assembly` + BOM + explode) — S10-U3/U4.
- **`wp_templates.work_category_id`** promotion + `clone_work_packages` reuse — S10-U6.
- Wiring estimate rates into `wp_profit`/GL; importing the BuildAll BOQ as live data (ADR §Out of
  scope).

## Verification

`pnpm db:test` (new `supabase/tests/database/245-spec236-boq-core.test.sql`) — structure, RLS/grant,
the three-grain invariant, the six RPCs' DEFINER+anon-revoke posture, behaviour + `23505`/`22023`/
`42501`. `pnpm lint && pnpm typecheck && pnpm test` green (regen `database.types.ts`).
