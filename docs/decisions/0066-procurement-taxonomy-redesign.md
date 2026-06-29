# ADR 0066 — Procurement taxonomy redesign: split the WORK axis from the MATERIAL axis; add facets, secondary membership, a global work-category library, the work↔material relation, and an estimate/assembly grain

## Status

Accepted (2026-06-29). Design-only acceptance: nothing lands in the repo at
acceptance time — this ADR + the numbered phase specs (223–232) + the progress-tracker
rows are authored in session **S0** (the first build session of the 11-session plan
S0–S10) and merged as a single governance-held PR. Every schema-bearing phase (S1, S2,
S4, S5, S6) ships later as its own operator-held migration PR.

Triggered by analysis of the BuildAll (บ.บิ้วออล) blank BOQ for project
**PRC-2026-004** — a repeatable 308 m² Thai Foods Fresh Market store: **426 line items
across 10 work-categories and ~49 subsections**. Forcing those 426 items into the spec
221 / spec 219 material taxonomy (13 main categories) left **98 items (23%) orphaned**,
and the two tool categories (`09 masonry_tools`, `10 machinery_tools`) caught **zero**
items — the BOQ groups by _trade/scope of work_, which the app has no first-class model
for. The catalog's `category` axis answers "what _kind of material_ is this," not "what
_work_ consumes it."

Relates: ADR 0055 dec.2 (category-as-table, not enum — the `equipment_categories`
precedent); ADR 0056 (membership-scoped visibility); ADR 0058 (`project_director`
see-all); ADR 0016 / 0059 (per-project FK + WP mutation lifecycle, the
`deliverable_id` precedent); ADR 0060/0061 (`wp_profit` / worker-ecosystem — why a WP's
work-category matters economically); spec 221 (managed material category taxonomy,
enum→`catalog_categories`, the 6-digit `product_code`); spec 219 (catalog
subcategory taxonomy + the composite FK); spec 207 (per-project `project_categories` +
`work_packages.category_id`, the [[wp-single-category-rule]]).

## Context

The app already carries fragments of both axes, but never names them as two axes:

- **MATERIAL axis (what a thing is).** `catalog_categories` (spec 221) is the managed
  main-category table feeding the catalog item's 6-digit `product_code`;
  `catalog_subcategories` (spec 219) is the second drill level, joined to items by a
  **composite FK** `catalog_items(subcategory_id, category_id) → catalog_subcategories(id, category_id)`.
  This axis is global (firm-wide), price-free, and is the canonical home of an item.
- **WORK axis (what work consumes a thing).** `work_packages.category_id` (spec 207 U2)
  is a nullable FK to **per-project, free-form** `project_categories`. The
  [[wp-single-category-rule]] locks a WP to exactly **one** work-category. But: the
  binding UI (spec 207 U3c `WpCategoryControl`) was never shipped; the taxonomy is
  per-project free text (no global library, no English, no MasterFormat anchor); and
  nothing relates a work-category to the materials that category typically buys.

Three concrete defects fall out of conflating these (the BOQ analysis named them C1–C3):

- **C1 — fulfillment masquerading as material.** Catalog category `13 custom_fabrication`
  (งานสั่งทำ) and the two tool categories `09`/`10` are not material _kinds_ — they are
  a _fulfillment mode_ (made-to-order) or an _asset class_ (tools/equipment). The schema
  half-knew this already: those items carry `stockable = false`. Bucketing the BOQ's
  made-to-order rows into category 13 collapses unlike things into one drawer.
- **C2 — an item lives in exactly one drawer.** The canonical-home model (one
  `category_id` + `subcategory_id` per item) cannot express an item that legitimately
  belongs to more than one material grouping (e.g. a steel section used both as
  structural steel and as a fabrication input).
- **C3 — per-project free-form work-categories don't generalize.** Each project reinvents
  its หมวดงาน; there is no shared, bilingual, stable-coded library, so cross-project
  reporting, scoped pickers, and a reusable estimate template are all impossible.

The operator's two driving use-cases (UC1, UC2) both need a **scoped picker**: when a
planner adds a material _to a work-category context_ (a supply-plan row whose WP carries
a work-category; a WP-detail PR / เบิก), the item picker should surface the materials that
work-category actually buys first — without ever hiding the rest (adoption cliff: today
≈0 WPs are categorised and the subcategory table has a single seed row). That requires a
**relation between the two axes**, which does not exist.

## Decision

Model the two axes as **permanently distinct**, give the catalog item the **facets** that
end the C1 conflation, add **additive secondary membership** for C2, **globalize** the
work axis for C3, **bridge** the two axes to power scoped pickers, and add a separate
**estimate/assembly grain** so a BOQ can be represented without polluting the price-free
catalog. Eight decisions:

### D1 — Two axes, never merged

The **WORK axis** (หมวดงาน — a work package carries exactly one, per
[[wp-single-category-rule]]) and the **MATERIAL axis** (a catalog item's category) are
orthogonal and stay separate tables. A WP is _not_ a material; a material does _not_ have
a single trade. No migration ever folds one into the other. This ADR's remaining
decisions all preserve this split.

### D2 — Material has ONE canonical home **plus** additive secondary membership

Each catalog item keeps a single **canonical** material home —
`catalog_items.category_id` + `catalog_items.subcategory_id` — which continues to drive
the 6-digit `product_code` (spec 221) and the spec-219 composite FK. That is unchanged
and authoritative.

For **C2**, add an **additive** junction
`catalog_item_categories(catalog_item_id, category_id, subcategory_id, is_primary)` that
lets an item also appear under other material groupings. The junction **reuses the
existing spec-219 composite FK** `(subcategory_id, category_id) →
catalog_subcategories(id, category_id)` — it does **not** invent a new key. Exactly one
membership row per item is `is_primary = true`, and it is **backfilled to mirror the
canonical** `category_id`/`subcategory_id` so the canonical home and the primary
membership can never disagree. Pickers read the **union** of the canonical home and the
secondary memberships. The canonical columns remain the source of truth for the product
code; the junction is purely additive discoverability.

### D3 — Facets on the catalog item; `fulfillment_mode` is the SSOT, `stockable` derives

Add three facet columns to `catalog_items`:

- `kind` — `material | tool | equipment | labor | service | softcost` (and, per D7,
  `assembly`). What _class of thing_ the item is.
- `fulfillment_mode` — `off_shelf | made_to_order`. How it is sourced.
- `owner_supplied` — boolean. Whether the client/owner supplies it.

`fulfillment_mode` becomes the **single source of truth** for whether an item is stocked;
`catalog_items.stockable` is **derived on write** from the facets (it is no longer an
independent input — the existing `p_stockable` passthrough is replaced by a derivation,
with back-compat kept for the live app). This ends **C1**: made-to-order is a fulfillment
_mode_, not a material _category_.

Consequently, the three mis-axised catalog categories are **deactivated, never dropped**
(`catalog_categories.is_active = false`): `13 custom_fabrication`, `09 masonry_tools`,
`10 machinery_tools`. Their items are **re-homed** to a true material/equipment class.
Because the `product_code` prefix derives from the category code, re-homing **shifts the
product-code prefix** of those items — so the re-home is a **guarded, LIVE-sourced,
destructive migration** (Procedure B / break-glass), deliberately kept **off** the
S1–S6 reserved-timestamp sequence and scheduled separately by the operator (spec 232 / S3).

### D4 — A global `work_categories` library above the per-project taxonomy

Introduce a firm-wide **`work_categories`** library (`name_th`, `name_en`, stable `code`,
optional `masterformat_code`), seeded from the BOQ's reconciled **W01–W09 + ~49
subsections**. The per-project `project_categories` table (spec 207) gains a **nullable**
`work_category_id` FK so a project's free-form category can be reconciled to a global one
without forcing it. The material axis is already global; add `name_en` there too for
parity. This fixes **C3**: a shared, bilingual, stable-coded work vocabulary that
cross-project reporting and the estimate template can lean on, while the per-project
freedom (and the locked one-category-per-WP FK) is preserved.

### D5 — Relation R: the work↔material bridge

Add **`work_category_material_categories(work_category_id, category_id, kind_filter)`** on
the **global** library — a many-to-many bridge declaring "this work-category typically
buys materials from these material-categories (optionally filtered to a `kind`)." Seeded
from the BOQ. This relation **powers the scoped pickers** (UC1/UC2): given a WP's
work-category, the picker pre-filters the catalog to the related material-categories.
It lives on the global library, not per-project, so every project benefits.

### D6 — A separate estimate/template/bid grain (`boq_template` / `boq_line`)

Estimating is its **own grain**, never the price-free catalog. Add `boq_template` +
`boq_line(catalog_item_id, work_category_id, qty, unit, material_rate, labor_rate,
is_standard, variation_type, line_status, exclusivity_group)`. A `boq_line` is where
**rates** live (material + labor split); the **catalog stays price-free**, and
`supply_plan_lines` stays **qty-only**. Bids fill rates against **frozen** `boq_line`
ids so competing bids are comparable line-for-line. This keeps three concerns — item
master (catalog), estimate (boq), execution plan (supply plan) — at three grains that
never bleed into each other.

### D7 — Assemblies: a `kind = assembly` item with an optional BOM

An **assembly** is a `catalog_item` with `kind = assembly` plus an **optional** bill of
materials `catalog_assembly_components(assembly_id, component_item_id, qty_per,
waste_factor)`. Without a BOM the assembly is opaque (a priced black box, like a "ชุด"
line — ~29% of the BOQ are ชุด lines); with a BOM it is **explodable** into its component
items. The BOM is optional so an assembly can be adopted incrementally.

### D8 — Security posture: grant-select + RPC-sole-writer, show-all-default pickers

Every new table follows the spec 221 U2 posture: **`grant select`** to the reading
roles, **no direct table write grant**, all writes through **SECURITY DEFINER** RPCs that
`set search_path = public`, capture the role once, gate **null-safe**
(`v_role IS NULL OR v_role NOT IN (...)` → raise `42501`), `revoke all ... from public,
anon` + `grant execute ... to authenticated`, and **never** use `service_role`. The
writer roles are `project_manager` / `super_admin` / `procurement` / `project_director`
on the catalog/material/work-library side, and `project_manager` / `super_admin` /
`project_director` on the WP/project side. Errcodes: `42501` (role), `22023` (bad arg),
`23505` (duplicate). Every **scoped picker shows ALL items by default** with an
empty-Relation-R fallback to the full catalog — the scope _reorders/pre-filters_, it
never _hides_ — because today almost nothing is categorised and a hiding picker would be
a dead end.

## Consequences

- **The two axes are first-class and permanent.** "What is this material" and "what work
  consumes it" stop fighting over one column. The BOQ's 426 items map cleanly: materials
  on the material axis, the 10 work-cats / ~49 subs on the new global work library, the
  bridge connecting them.
- **C1/C2/C3 are closed.** Made-to-order is a facet; an item can carry secondary
  memberships; the work axis is global, bilingual, and reusable.
- **`stockable` becomes derived.** Any code that wrote `stockable` directly must move to
  setting `fulfillment_mode`; the catalog write RPCs derive `stockable` and keep the
  `p_stockable` arg for back-compat (the live app keeps working).
- **The C1 re-home is the only irreversible step** and stays operator-signed break-glass:
  deactivating cats `09/10/13` and re-homing their items shifts `product_code` prefixes,
  so it runs under `break-glass.md` Procedure B (verified `pg_dump` floor +
  preview-branch rehearsal) and also updates `catalog_item_categories.is_primary` for the
  re-homed items. It is intentionally off the additive S1–S6 migration sequence.
- **Scoped pickers never hide.** Because Relation R may be empty for a work-category (and
  most WPs are uncategorised), every picker falls back to the full catalog; the scope is a
  reordering/pre-filter, asserted by tests.
- **Estimating gains a home that doesn't pollute the catalog.** Rates live on `boq_line`;
  the catalog stays price-free; the supply plan stays qty-only. The three grains stay
  disjoint.
- **Schema is single-lane and serialized.** S1 → S2 → S4 → S5 → S6 each take the schema
  lane in turn, with reserved migration timestamps `20260813029000`–`20260813033000`;
  the downstream session re-claims the lane + re-verifies no later migration landed before
  writing SQL. S7/S8/S9 are code-only (auto-merge); S10 is a later multi-session epic.
- **Most phases are operator-held one-tap merges.** Every migration trips the danger-path
  guard, so S1/S2/S4/S5/S6 (and this S0 governance PR) wait for the operator; only the
  pure-UI S7/S8/S9 auto-merge on green.

## Alternatives rejected

- **Cram the work axis into the material categories (status quo).** Rejected: it is the
  root cause — 23% of the BOQ orphaned, tool categories empty, made-to-order conflated
  with material. The two axes answer different questions.
- **Make the work-category a multi-membership join on the WP.** Rejected: violates the
  locked [[wp-single-category-rule]] (a WP belongs to exactly one work-category); the
  single-FK model (the `deliverable_id` precedent) is retained.
- **Invent a new key for the secondary-membership junction.** Rejected: D2 deliberately
  **reuses** the existing spec-219 composite FK so the junction can never reference a
  material grouping the canonical home cannot.
- **Keep `stockable` an independent input.** Rejected: it is exactly the C1 signal the
  schema already half-encoded; making `fulfillment_mode` the SSOT and deriving `stockable`
  removes the contradiction (an item flagged made-to-order yet stockable).
- **Put rates on the catalog item.** Rejected: the catalog is the price-free item master
  shared across projects; rates are estimate/bid data and belong on `boq_line`, frozen per
  bid. Conflating them would make every price edit a catalog mutation.
- **DROP the mis-axised categories `09/10/13`.** Rejected: deactivate-not-delete is the
  house convention (`catalog_items.is_active`, masters-no-delete); historical items and
  product codes must remain resolvable. The re-home shifts prefixes but never deletes the
  category rows.
- **Per-project work libraries only (no global).** Rejected: defeats C3 — no
  cross-project reporting, no reusable estimate template, no shared scoped-picker relation.
  The global library sits **above** the per-project taxonomy via a nullable FK, so
  per-project freedom is preserved.
