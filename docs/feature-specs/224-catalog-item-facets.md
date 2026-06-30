# Spec 224 — Catalog item facets: `kind` / `fulfillment_mode` / `owner_supplied` + derived `stockable` (ADR 0066 / S2)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D3**. This is **session S2**. **Autonomy class: 🔔 ONE-TAP HOLD** — schema
migration + catalog write-RPC change trip the danger-path guard. **Reserved migration
timestamp: `20260813030000`.** Schema is single-lane.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing pgTAP** (RPC behaviour + columns) and the **failing Vitest** (form +
> action mapping) FIRST. These bullets ARE the red tests.

1. `catalog_items` carries three new facet columns: `kind`
   (`material | tool | equipment | labor | service | softcost`; `assembly` is added in
   spec 231/S7, not here), `fulfillment_mode` (`off_shelf | made_to_order`),
   `owner_supplied boolean NOT NULL default false`. All status-ish fields are **Postgres
   enums**, never free-text (house rule).
2. **`fulfillment_mode` is the SSOT for stocking; `stockable` is DERIVED on write**:
   `stockable := (fulfillment_mode = 'off_shelf')` (the canonical derivation — confirm the
   exact rule against the live `stockable` semantics at build; made-to-order ⇒ not stocked).
   The previous `p_stockable` passthrough is **replaced by the derivation**, but the RPC
   **keeps the `p_stockable` parameter for back-compat** (live app still passes it; the
   value is ignored in favour of the derivation, OR used only when `p_fulfillment_mode` is
   omitted — pin the chosen rule in pgTAP).
3. `create_catalog_item` / `update_catalog_item` are **DROP+CREATE'd** to accept
   `p_kind` / `p_fulfillment_mode` / `p_owner_supplied` with **trailing defaults** so
   existing positional callers and `::regprocedure` pins stay valid (the 221 U2 / U3b
   precedent: add params with defaults, don't reorder existing ones; re-pin
   `::regprocedure` in the test).
4. Existing items get a **backfill**: `fulfillment_mode` defaults to `off_shelf` and
   `kind` to `material` except where the current category/`stockable` indicates otherwise
   (e.g. `stockable = false` → `made_to_order`); `owner_supplied` defaults false.
5. pgTAP pins: facet columns + enum types; derived-`stockable` matches `fulfillment_mode`
   on insert AND update; back-compat (an old-arity call still succeeds and derives
   correctly); role gate `42501`; `22023` on bad enum; eval-once; DEFINER + anon-revoke.
6. `pnpm lint && pnpm typecheck && pnpm test` + `pnpm db:test` green.

## Why (ADR 0066 D3)

The catalog conflates _material kind_ with _fulfillment mode_ and _asset class_ (defect
**C1**). The schema already half-encodes fulfillment via `stockable = false` on the 17/71
direct-to-WP items. D3 promotes that signal to explicit facets and makes
`fulfillment_mode` authoritative, deriving `stockable` so the two can never contradict
(an item can't be flagged made-to-order yet stockable). This is the precondition for the
S3 re-home of the mis-axised categories `09/10/13` (spec 232) and for the scoped pickers'
`kind_filter` (Relation R, spec 227).

## Schema (one additive migration, `20260813030000`)

> **Schema-lane protocol (MANDATORY before any SQL):** APPEND your LANES.md claim with
> branch + reserved ts `20260813030000`, **RE-READ** to confirm no concurrent schema claim,
> and **re-verify no later migration landed** (the `+1000` floor moves; if S1's `029000`
> isn't yet merged to main, branch off the branch/commit that has it or coordinate — do
> NOT skip a number). ONE schema lane at a time.

- `alter type` / new enums for `catalog_item_kind` + `catalog_fulfillment_mode` (own
  migration statements; enum-add is its own concern per the DB-migration lessons).
- `alter table public.catalog_items add column kind catalog_item_kind …`,
  `add column fulfillment_mode catalog_fulfillment_mode …`,
  `add column owner_supplied boolean NOT NULL default false`.
- Backfill UPDATE (additive, not destructive — column-add + backfill of NULLs only).
- **DROP+CREATE** `create_catalog_item` / `update_catalog_item` from the **LIVE** function
  bodies (source via `pg_get_functiondef` from the live DB — never re-source from an old
  migration file; the [[prc-ops-db-migration-lessons]] trap), adding the three facet params
  with trailing defaults, deriving `stockable`, re-pinning `::regprocedure`.

### RPC posture (mirror spec 221 U2 / U3b exactly)

`security definer`, `set search_path = public`; capture role once; **null-safe** gate
`if v_role is null or v_role not in
('project_manager','super_admin','procurement','project_director') then raise … 42501`;
`22023` on bad enum value / blank; `revoke all on function … from public, anon; grant
execute … to authenticated`; **never service_role**. Keep the **trailing defaults** on the
pre-existing params so the live app's current call sites keep resolving (221 U3b
precedent — back-compat is a hard requirement).

## Files the downstream session touches (real anchors)

- `supabase/migrations/20260813021000_spec221u3b_optional_category.sql:17-164` — the
  current `create_catalog_item` / `update_catalog_item` overload shape to mirror
  (DROP+CREATE, trailing defaults, `::regprocedure` re-pin). **Re-source the bodies from
  LIVE**, not from this file.
- `src/app/catalog/actions.ts:91,104,165,176` — the `createCatalogItem` /
  `updateCatalogItem` server-action call sites that pass the RPC args; thread the three new
  facet inputs (with safe defaults so a form that doesn't set them still works).
- `src/components/features/catalog/catalog-item-form.tsx` — add the facet controls (kind
  select, fulfillment-mode select, owner-supplied checkbox); **remove the direct
  `stockable` input** (it's derived) or make it read-only/derived.
- new `supabase/migrations/20260813030000_spec224_catalog_item_facets.sql`
- new `supabase/tests/database/NNN-spec224-catalog-item-facets.test.sql`
- `src/lib/db/database.types.ts` — regenerate after `db:push`.

## Caveat (carry into the build)

**Deriving `stockable` REPLACES the `p_stockable` passthrough — keep back-compat.** The
live app still calls the RPC with `p_stockable`; do not break that arity. The parameter
stays (ignored-or-fallback per the pinned rule); the _value written_ is the derivation.
pgTAP must prove an old-arity call still succeeds and lands the correct derived
`stockable`.

## Out of scope

- The C1 re-home of categories `09/10/13` and the product-code prefix shift — that is
  **spec 232 / S3** (break-glass, off-sequence). S2 only adds the facets the re-home needs.
- `kind = 'assembly'` and the BOM — spec 231 (S10).
- Any picker scoping — specs 228/229.

## Verification

- `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file green; **signature-pin tests
  re-pinned to the new arity**, no other RPC churn).
- `pnpm lint && pnpm typecheck && pnpm test`.
- Preview the item form: set fulfillment-mode = made-to-order → saved item reads
  `stockable = false`; off-shelf → `stockable = true`.
