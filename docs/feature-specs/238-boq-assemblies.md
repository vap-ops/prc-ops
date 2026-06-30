# Spec 238 — Assemblies: `kind=assembly` + `catalog_assembly_components` BOM + explode (ADR 0066 / S10-U3)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D7**. Parent epic: [231 — estimate/template/bid layer](231-estimate-template-bid-layer.md)
(§Decomposition note (c)). Builds on **[224 — catalog facets](224-catalog-item-facets.md)** (S2, the
`catalog_item_kind` enum). **Session S10-U3.** **Autonomy: 🔔 ONE-TAP HOLD** (schema migrations).
Schema lane, reserved migration ts **`20260813041000`** (enum add) + **`20260813042000`** (BOM + RPCs +
explode). True max on `main` = `040000`.

## Operator decision locked (2026-06-30)

- **D5 — explode is COMPUTED-ON-READ** (a resolver/function, **no persisted explosion rows**). Cheap,
  reversible; persistence (writing exploded component lines) is a later unit if ever needed.

## Why (ADR 0066 D7)

~29% of the BuildAll BOQ are ชุด ("set"/assembly) lines. D7 makes an assembly first-class: a
`catalog_item` with `kind = assembly` plus an **optional** bill of materials. Without a BOM it is an
opaque priced black box (a ชุด line); with a BOM it can be **exploded** into its component items'
quantities on demand.

## Acceptance criteria / Definition of Done (test-first)

1. **`catalog_item_kind` gains `assembly`** (`alter type … add value 'assembly'`) — in its **own**
   migration (`041000`), because `ALTER TYPE … ADD VALUE` cannot run in the same transaction as the
   table/function that uses the new label. pgTAP pins the label is present.
2. **`catalog_assembly_components`** (`042000`): `id` uuid PK · `assembly_id` → `catalog_items(id)`
   **ON DELETE CASCADE** · `component_item_id` → `catalog_items(id)` **ON DELETE RESTRICT** · `qty_per
numeric(14,4) not null` (`qty_per > 0`) · `waste_factor numeric(6,4) not null default 0` (`>= 0`) ·
   `created_by` · `created_at`. A **self-reference is forbidden** (`assembly_id <> component_item_id`,
   CHECK). **Unique `(assembly_id, component_item_id)`** (a component appears once per assembly). RLS
   enabled; **grant SELECT to authenticated**; **no direct write/delete grant**; **no DELETE**
   (removal via the RPC). Indexes on both FKs.
3. **The BOM attaches only to an assembly-kind item** — `add_assembly_component` rejects a parent whose
   `catalog_items.kind <> 'assembly'` (`22023`). The BOM is **optional** (an assembly may have zero
   components → opaque black box).
4. **Write RPCs** (D8 posture: SECURITY DEFINER, `set search_path = public`, role captured once,
   null-safe gate `v_role is null or not in (...)` → `42501`, `revoke … from public, anon` + `grant
execute … to authenticated`, never `service_role`; role = `project_manager`/`super_admin`/
   `procurement`/`project_director`):
   - `add_assembly_component(p_assembly_id, p_component_item_id, p_qty_per, p_waste_factor default 0)`
     → `uuid`. Unknown assembly / non-assembly parent / unknown component / self-reference /
     `qty_per <= 0` / negative waste → `22023`; duplicate `(assembly, component)` → `23505`.
   - `update_assembly_component(p_id, p_qty_per, p_waste_factor default 0)` → void. Unknown id →
     `22023`; same qty/waste validation.
   - `remove_assembly_component(p_id)` → void (definer-deletes; no table delete grant). Unknown → `22023`.
5. **Explode (computed-on-read, D5)** — `explode_assembly(p_assembly_id uuid, p_qty numeric default 1)`
   returns a set of `(component_item_id, qty_per, waste_factor, effective_qty)` where `effective_qty =
qty_per * (1 + waste_factor) * p_qty`. **Single-level** (direct components only) for v1. A plain
   `stable` SQL function (SECURITY INVOKER — reads through the caller's RLS), `grant execute to
authenticated`. An assembly with no BOM returns zero rows. pgTAP pins the arithmetic.

## Out of scope (later units / deferred)

- **Nested explosion** (an assembly whose component is itself an assembly) — v1 explode is single-level;
  recursive expansion + cycle handling is a future unit. Logged as an open question.
- **Persisted explosion** (writing exploded rows into a boq/supply grain) — D5 chose computed-on-read.
- **The assembly authoring + explode UI** (BOM editor on the catalog item form, explode view) —
  **S10-U4**.
- Wiring assemblies into `boq_line` / `wp_profit` beyond the catalog grain.

## Verification

`pnpm db:test` (new `supabase/tests/database/246-spec238-boq-assemblies.test.sql`) — enum label,
table/RLS/grant/no-delete, FKs + ON DELETE, self-ref + unique + qty/waste checks, the 3 RPCs'
DEFINER+anon-revoke posture + behaviour (`22023`/`23505`/`42501`, non-assembly-parent reject), and the
explode arithmetic. `pnpm lint && pnpm typecheck && pnpm test` green (regen `database.types.ts`).
