# Spec 232 — C1 re-home: deactivate mis-axised categories 09/10/13 + re-home items (ADR 0066 / S3) — BREAK-GLASS

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D3** (the irreversible half). This is **session S3**. **Autonomy class: 🧨
OPERATOR-GATED BREAK-GLASS (Procedure B)** — a **destructive** migration that **shifts
`product_code` prefixes**; it is kept **OFF** the S1–S6 reserved-timestamp sequence and its
migration timestamp is assigned **at scheduling time** by the operator. Read
`docs/break-glass.md` in full before any work.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing pgTAP** FIRST (it asserts the post-re-home end state). These bullets
> ARE the red tests. The migration runs only after the operator signs off (Procedure B).

1. Catalog categories `13 custom_fabrication`, `09 masonry_tools`, `10 machinery_tools`
   are **deactivated** (`catalog_categories.is_active = false`) — **NEVER dropped** (rows,
   codes, and historical references remain resolvable; deactivate-not-delete house rule).
2. Every item currently homed under `09/10/13` is **re-homed** to a true material/equipment
   class consistent with its spec-224 facets (e.g. made-to-order → a material category with
   `fulfillment_mode = made_to_order`; tools → an equipment/tool class). Re-home updates the
   canonical `category_id`/`subcategory_id`.
3. Because `product_code`'s prefix derives from the category code, the re-home **shifts the
   product-code prefix** of re-homed items — the migration recomputes/relabels those codes
   per the spec 221/214 derivation. pgTAP pins: no re-homed item retains a `09/10/13`
   prefix; every re-homed code is valid + unique.
4. The re-home **also updates `catalog_item_categories.is_primary`** (spec 225 / S4) for
   re-homed items so the secondary-membership primary row continues to mirror the new
   canonical home (canonical and primary can never disagree).
5. Audit: a mandatory `audit_log` row records the break-glass action (Procedure B).
6. Post-migration `pnpm db:test` green (the new pgTAP + all existing — especially the
   product-code + spec-225 primary-mirror pins).

## Why (ADR 0066 D3 — defect C1) + why break-glass

Categories `13/09/10` encode a **fulfillment mode / asset class**, not a material kind
(defect **C1**). Spec 224 (S2) added the facets that let those items live correctly on the
material/equipment axis; this spec moves them there and retires the mis-axised drawers.
It is **break-glass** because it is the only step in the whole program that **mutates
existing identifiers** (`product_code` prefixes shift) and re-points canonical homes —
irreversible without the `pg_dump` floor. Hence: **off the additive S1–S6 sequence**, its
timestamp assigned only when the operator schedules it, under Procedure B.

## Procedure (break-glass — `docs/break-glass.md` Procedure B)

> **DEPENDENCIES:** S2 (spec 224, facets) **and** S4 (spec 225, `catalog_item_categories`)
> MUST be merged first — this spec writes both the facet-consistent new home and the
> `is_primary` membership mirror.

1. **Source from LIVE.** Re-source the affected item set + the `product_code` derivation
   from the live DB (`pg_get_functiondef` / live SELECTs) — never re-source from an old
   migration file (the [[prc-ops-db-migration-lessons]] trap).
2. **`pg_dump` floor + preview-branch rehearsal.** Take the verified `pg_dump`; rehearse the
   whole re-home on a Supabase preview branch; confirm the post-state pgTAP passes there
   before touching prod.
3. **Schema-lane claim.** APPEND the LANES.md claim with the operator-assigned timestamp;
   RE-READ; re-verify no later migration landed.
4. **Guarded transaction.** Deactivate `09/10/13`; re-home items (canonical
   `category_id`/`subcategory_id`); recompute `product_code`; update
   `catalog_item_categories.is_primary`; write the mandatory `audit_log` row. Single
   transaction.
5. **Operator owns the merge, the timestamp, and the `db push`.**

## Files the downstream session touches (real anchors)

- `docs/break-glass.md` — Procedure B (read in full first).
- `supabase/migrations/<operator-assigned-ts>_spec232_category_rehome.sql` — the guarded
  destructive migration (timestamp assigned at scheduling time, NOT from the `029000–033000`
  sequence).
- `src/lib/catalog/validate.ts` — the `composeProductCode` / `productCodeTailLength`
  derivation (spec 221 U4) used to recompute shifted codes.
- new `supabase/tests/database/NNN-spec232-category-rehome.test.sql` — the post-state pins.
- `src/lib/db/database.types.ts` — regenerate after `db:push`.

## Out of scope

- Dropping any category (deactivate-not-delete only).
- Re-homing items not under `09/10/13`.
- The facets themselves (spec 224) or the junction (spec 225) — prerequisites, not part of
  this migration.

## Verification

- Preview-branch rehearsal green BEFORE prod.
- Post-prod: `pnpm db:test` green; no re-homed item carries a `09/10/13` product-code
  prefix; every `is_primary` membership still mirrors the (new) canonical home; the
  `audit_log` row exists.
