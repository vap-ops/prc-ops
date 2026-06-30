# Spec 237 — BOQ estimate authoring UI (ADR 0066 / S10-U2)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D6**. Parent epic: [231 — estimate/template/bid layer](231-estimate-template-bid-layer.md)
(§Decomposition note (b)). Builds on **[236 — BOQ estimate core](236-boq-template-line-core.md)** (S10-U1,
the `boq_template` + `boq_line` schema + RPCs). **Session S10-U2.** **Autonomy: ✅ AUTO-MERGE** (code-only —
no migration, no schema lane). Reuses the S1 unit picker, S5 work-category library, and S7
`ScopedCatalogItemPicker`.

## Why

U1 shipped the estimate grain (tables + 6 DEFINER RPCs) but nothing in the app drives them. U2 is the
authoring surface: a firm-wide back-office screen to create reusable BOQ templates and edit their lines, so
an estimator can build the BuildAll-style BOQ by hand. Pure UI + server actions over the U1 RPCs.

## Acceptance criteria / Definition of Done (test-first)

1. **Templates list + create** — a back-office screen lists every `boq_template` (active first, inactive
   shown muted), each linking to its detail view. A create form (code, name, optional description) calls
   `create_boq_template`. Gated to the BOQ writer roles (`project_manager`/`super_admin`/`procurement`/
   `project_director`) on both the page (`requireRole`) and the server action (`requireActionRole`); the
   DEFINER RPC gates again.
2. **Template detail** — shows the template header (code · name · active state) with rename
   (`update_boq_template`) + activate/deactivate (`set_boq_template_active`) controls, and its `boq_line`
   rows in `sort_order` then `created_at` order. Each line shows: description, the linked catalog item (if
   any) or a "free-text" marker, work-category name (if any), `qty` × `unit`, `material_rate`, `labor_rate`,
   the computed **line total** `qty × (material_rate + labor_rate)`, and `variation_type` / `is_standard` /
   `exclusivity_group` when set. A **template grand total** = Σ line totals.
3. **Add a line** — a form on the detail view: required free-text `description`; `qty`; `unit` via the **S1
   `catalog_units` picker** (with the free-text escape hatch); an **optional** catalog item via the **S7
   `ScopedCatalogItemPicker`** (passed NO scope → full catalog, since a firm-wide template carries no WP
   work-category context — D1: a line need not be a catalog item); an **optional** work-category via a
   picker over the **global `work_categories` library** (S5); `material_rate`; `labor_rate`; `is_standard`;
   `variation_type`; optional `exclusivity_group`. Calls `add_boq_line`.
4. **Edit + remove a line** — edit any field of a line (`update_boq_line`) and remove a line
   (`remove_boq_line`), each confirm-gated for remove. (Per U1, editing never changes `line_status` — the
   freeze transition is U5.)
5. **Money formatting** uses the `src/lib/format.ts` SSOT (no re-rolled baht/round). All user-facing strings
   route through the labels SSOT where a term repeats. Server Components by default; `'use client'` only for
   the interactive forms, justified in the PR.

## Out of scope (later S10 units / deferred)

- **Freeze / bid** (`draft → frozen`, bid submission, bid-compare) — S10-U5.
- **Assemblies** (`kind = assembly` + BOM + explode) — S10-U3/U4.
- **Clone / instantiate a template into a project** (D3 instantiation) — a later unit (U6-adjacent).
- **Scoping the item picker by the line's work-category** via Relation R (S6) — a nice enhancement, but it
  couples item-pick to work-cat-pick ordering; U2 uses the unscoped full-catalog picker. Logged as an open
  question.
- Reordering lines (drag / `sort_order` editing) — the column exists; a reorder control is deferred.

## Verification

`pnpm lint && pnpm typecheck && pnpm test` green. New Vitest covers: the pure line-total / grand-total
helper (qty × (material+labor), Σ), the server actions (role-reject + RPC call shape), and the add/edit-line
form (renders the S1/S5/S7 pickers, submits the expected payload). No DB migration; `pnpm db:test`
unaffected.
