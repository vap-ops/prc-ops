# Spec 231 — Estimate / template / bid layer: `boq_template` + `boq_line` + assemblies + bids (ADR 0066 / S10)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decisions **D6 / D7**. This is **session S10** — the **largest, last** unit. **Autonomy
class: MIXED + multi-session** (schema migrations are 🔔 ONE-TAP HOLDs; UI sub-units
auto-merge). **This spec is a LATER epic**, scheduled after S1–S9 land; it is authored
here as the program's north star, **to be decomposed into its own numbered sub-specs at
build time** (migration timestamps assigned then, off the S1–S6 reserved sequence).

## Acceptance criteria / Definition of Done (test-first intent — high level)

> Each sub-unit follows the house TDD loop (failing pgTAP/Vitest first). The headline DoD:

1. `boq_template` + `boq_line(catalog_item_id, work_category_id, qty, unit, material_rate,
labor_rate, is_standard, variation_type, line_status, exclusivity_group)` exist;
   **rates live on `boq_line`**, the **catalog stays price-free**, and `supply_plan_lines`
   stays **qty-only** (D6's three-grain separation is preserved and pgTAP-pinned).
2. **Bids fill rates against FROZEN `boq_line` ids** — a bid references the template's line
   ids so competing bids are line-for-line comparable; a bid-compare view ranks them.
3. **Assemblies (D7):** a `catalog_item` with `kind = 'assembly'` (the enum value added
   here, extending spec 224's `catalog_item_kind`) + an **optional**
   `catalog_assembly_components(assembly_id, component_item_id, qty_per, waste_factor)` BOM.
   No BOM → opaque priced black box; with a BOM → explodable into component items.
4. ⚠️ **AMENDED 2026-07-27 — `wp_templates` no longer exists.** This point originally
   promoted it to carry `work_category_id`. The table and `apply_wp_template` were
   **retired** (`20260813075857_retire_wp_templates.sql`): never used, and keyed on the
   `project_type` enum rather than the `work_categories` axis the app settled on. The
   promotion had already conceded the table was unusable as-is, so nothing is lost —
   S10-U6 builds the WP-seeding template on **`boq_template` / `boq_line`** (live since
   spec 236) and still **reuses `clone_work_packages`** rather than a new clone path.
   See spec 142 "U5 was retired, not built".
5. All new tables/RPCs follow the spec 221 U2 posture (DEFINER, null-safe gate, anon-revoke,
   never service_role); all status fields are enums; estimate rates never leak into the
   catalog.

## Why (ADR 0066 D6/D7)

The BuildAll BOQ is an **estimate**, a different grain from the item master (catalog) and
the execution plan (supply plan). ~29% of its lines are ชุด/assembly lines. D6 gives
estimating its own home so rates and variations don't pollute the price-free catalog; D7
makes assemblies first-class so a priced "ชุด" can later be exploded into its components.
Bids reuse the frozen estimate grain for apples-to-apples comparison.

## Anchors / reuse (real)

- `clone_work_packages` — the surviving reuse anchor; reuse, do not reinvent.
  (`wp_templates` was the other half of this pair and is **GONE** as of
  2026-07-27 — retired unused; do not plan against it.)
- `catalog_item_kind` enum (from spec 224 / S2) — extend with `assembly`.
- `boq_line.catalog_item_id` → `catalog_items`; `boq_line.work_category_id` →
  `work_categories` (the global library from spec 226 / S5).
- `supabase/migrations/` — new timestamps assigned at build time (off the S1–S6 reserved
  `029000–033000` sequence).

## Decomposition note

At build time, split S10 into sub-specs (suggested): (a) `boq_template`/`boq_line` schema +
RPCs; (b) the estimate authoring UI; (c) assemblies (`kind=assembly` + BOM + explode); (d)
bid submission + compare; (e) WP seeding from a `boq_template` + `clone_work_packages`
reuse (was "`wp_templates` work_category_id promotion" — that table is retired, see point 4). Each sub-spec claims the schema lane + a fresh reserved timestamp per the protocol,
re-reads LANES.md, and re-verifies no later migration landed before writing SQL.

## Out of scope (for the program; revisit per sub-spec)

- Wiring estimate rates into `wp_profit` / GL beyond what an explicit sub-spec specifies.
- Importing the BuildAll BOQ as live data (a separate data-load exercise; this spec is the
  schema/UI that would receive it).

## Verification

- Per sub-unit: the house verification (`pnpm db:test` for DB sub-units; `pnpm lint &&
pnpm typecheck && pnpm test` for all). The three-grain invariant (catalog price-free,
  boq_line priced, supply_plan_lines qty-only) is pgTAP-pinned.
