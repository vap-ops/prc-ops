# Spec 301 — PR-flow WP letter-code consolidation + approver-side off-category flag

**Status:** approved (operator, 2026-07-12, in-chat AskUserQuestion)
**Scope decision:** full letter-code sweep (purchasing + supply-plan + store) + off-category flag on request DETAIL + procurement GRID only (NOT the phone list card — operator declined).
**Type:** code-only, no schema. 3 units, each its own PR.

## Why

Procurement asked to see the WP code on each PR. The app today shows the SAME work
package under two display formats split by team: SA/PM surfaces render the spec-277
letter-code (`E-12`, `<WpCategoryCode>` — color + icon + category letter), while every
purchasing/supply-plan/store surface renders the raw `work_packages.code` (`WP-12`) in
plain mono. Cross-team conversation about one WP uses two different codes. Consolidate
the DISPLAY to the letter-code SSOT everywhere. DB codes are untouched (spec 277 locked:
display-only; legacy codes are never renamed).

Second, spec 297 shipped the off-category flag (`นอกหมวดงาน`) at PICK time only and
explicitly deferred the approver-side flag ("category not stored on the PR — would need
recompute"). This spec is that follow-on: recompute the same match server-side and show
the same passive amber flag where the approve/PO decision happens.

## Non-goals

- No DB `code` rename, no `letter_code` column (spec 277 U2 owns that).
- No flag on the phone/site list card (operator declined — decision surfaces only).
- No approval gating/blocking — the flag is information, matching the operator's
  spec-297 "passive warning" decision. Off-category picks are EXPECTED (297 U2
  flipped the picker default to show-all).
- No kindFilter semantics for the PR match — parity with the PR picker (`scopeCatalogItems`,
  category-only UC1), NOT the เบิก stock picker (UC2). The review flag must agree with
  what the picker showed at pick time.
- No `equipment_items` changes.

## Shared foundation (built in U1)

`src/lib/work-categories/load-category-codes.ts` — `loadCategoryCodeById(supabase, categoryIds)`:
batch-reconcile distinct `project_categories.id` → global `work_categories.code`
(`select("id, work_categories(code)").in("id", …)`, with the object/array embed-shape
guard from `loadWpCategoryScope`). Returns `Map<projectCategoryId, code>`. This pattern
is currently copy-pasted in 4 pages (`projects/[projectId]`, `sa`, `sa/crew`, `sa/plan`) —
refactoring those onto the helper is a flagged follow-up, NOT this spec.

## U1 — letter-code on purchasing surfaces (code-only PR)

Thread `categoryCode` and swap raw-code renders for `<WpCategoryCode code categoryCode>`:

| Surface                      | Render site                                    | Data path change                                                                                                                           |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| /requests list card          | `purchase-request-card.tsx` (raw code span)    | `loadRequestsData.loadWpById` selects `+ category_id`; new `categoryCodeByWpId` via `loadCategoryCodeById`; `WpLabel` gains `categoryCode` |
| /requests procurement grid   | `procurement-grid.tsx` (raw `wp_code`)         | same map, thread through the grid row model                                                                                                |
| /requests/[id] detail header | `[requestId]/page.tsx` (raw code, x2 branches) | `loadRequestDetail` WP select `+ category_id`; reconcile via `loadCategoryCodeById` (single id)                                            |
| Raise-PR form WP chip        | `purchase-request-form.tsx`                    | parent already resolves the WP's scope (spec 228/289 `loadWpCategoryScope`) — thread the existing `workCategoryCode` prop down             |
| Create-PO sheet lines        | `create-purchase-order-sheet.tsx` (`wp_code`)  | same /requests page data — thread categoryCode with the wp label                                                                           |
| Phone PO basket              | `phone-po-basket.tsx` (`wp_code`)              | same                                                                                                                                       |

Uncategorised WP → `<WpCategoryCode>` degrades to the plain mono code (verified: component
returns bare span when identity is null). No visual regression for unbound WPs.

Tests: pure map/threading unit tests + RTL render asserts (letter-code shown when
categoryCode present, raw code fallback when null) per surface. Respect the RTL
accessible-name collision noted in spec 297 U2 (scope text asserts to the row).

## U2 — PR provenance WP + off-category flag on detail + grid

**Build discovery (2026-07-12, operator-approved):** ADR 0065 store-only NULLs
`work_package_id` on every modern PR and discarded the raising WP entirely —
zero live PRs had both an item and a WP, so the flag as originally scoped could
never fire, and procurement saw no WP on any new request. Fix folded into U2:

- **U2a schema** — migs `20260813075730` (additive
  `purchase_requests.requested_from_work_package_id` uuid FK + explicit
  column-level INSERT grant to authenticated — the table grants INSERT per
  column, #435 lesson) and `20260813075740` (FK → `on delete set null` + index;
  fresh-eyes finding: `delete_work_package`'s empty-guard checks only the
  binding column, provenance must never block a WP delete). pgTAP `301-*.sql`.
- **U2b stamp** — `createPurchaseRequest` records the raising WP in the new
  column; `work_package_id` stays NULL (receipt/custody unchanged).
- **U2c anchor** — list/detail/grid WP display + the verdict anchor on
  `work_package_id ?? requested_from_work_package_id`.

Match semantics = EXACTLY the picker's: `scopeCatalogItems` fed one item
(`{id, categoryId}` from `catalog_items.category_id`) + `membershipsByItem(loadCatalogItemMemberships(...))`

- scope = deduped `categoryId`s of `loadWpCategoryScope(wp.category_id).scopedRelation`.
  Flag states:

* `match` → green `ตรงกับงาน` (`WORK_CATEGORY_MATCH_LABEL`) — same as picker.
* `mismatch` → amber `นอกหมวดงาน` (`WORK_CATEGORY_MISMATCH_LABEL`) — same as picker.
* `null` (no flag): free-text PR (no `catalog_item_id`), WP-less PR, uncategorised WP,
  unreconciled project-category, empty Relation-R (`scoped === false`). Exactly the
  picker's `scopeActive` gating.

New pure helper `src/lib/purchasing/pr-category-match.ts` — `prCategoryMatch(...)` returning
`"match" | "mismatch" | null`, built ON `scopeCatalogItems` (no re-implementation of the
match). TDD the truth table above.

Surfaces:

- **Detail** `/requests/[requestId]`: loader gains the recompute (WP `category_id` already
  added in U1; + `catalog_items.category_id` for the PR's item + memberships + scope);
  render a chip near the item description. Amber styling = spec-297 tokens
  (`text-attn-*` family; `text-meta` is a SIZE token, pair with a color class).
- **Procurement grid**: batch recompute inside `loadRequestsData` (procurement-gated like
  reads #8–#12): reuse U1's `category_id`-enriched `wpById` + `resolveWorkCategoryScopes`
  (batch Relation-R) + existing `prCategory` item links + `loadCatalogItemMemberships`;
  new `categoryMatchById: Map<prId, "match" | "mismatch" | null>`; grid renders the amber
  flag only (green tick optional — keep the grid quiet, amber is the signal).

Labels: REUSE spec-297 constants — no new `labels.ts` keys expected. If copy needs a
grid-width short form, add ONE key (labels.ts is shared-SSOT; note in LANES).

## U3 — letter-code on supply-plan + store surfaces (code-only PR)

**Build corrections:** `store-manager.tsx` / `store-count-manager.tsx` render
PROJECT codes (โครงการ picker), not WP codes — DESCOPED. The supply-plan WP
picker is a native `<select>` — options/optgroup labels carry no markup, so
those letter-code as TEXT via the new pure `wpDisplayCode(code, categoryCode)`
(`format-code.ts`; same graceful degrade to the raw code).

Shipped surfaces: `supply-plan-manager.tsx` (options ×3 + multi-WP checklist +
aria-labels, via `wpDisplayCode`; `WpPickerRow`/`WpPickerOption` gain
`categoryCode` — optional on rows, so `sa/plan`'s builder keeps compiling and
degrades to raw), saved-line `wpLabel` (embed + page wpId→W0x map),
`supply-plan-accuracy.tsx` (`<WpCategoryCode>`), `material-log-view.tsx`
(`<WpCategoryCode>`; the store item page batch-reconciles via
`loadCategoryCodeById` on the user client — member-visible page).

## Verification checklist

- [ ] U1: /requests (procurement + requester views), request detail, raise-PR chip, PO
      sheet/basket show `E-12`-style codes for categorised WPs; uncategorised show raw code.
- [ ] U2: a PR whose item's category ∉ WP scope shows `นอกหมวดงาน` on detail + grid; a
      matching one shows `ตรงกับงาน` on detail; free-text/WP-less/uncategorised show nothing.
- [ ] U3: supply-plan + store rows letter-coded.
- [ ] Guard suites (design-doctrine, ui-class-contracts) green; full suite green.
- [ ] Browser real-flow per unit (dev-preview login).

## Open questions / flagged follow-ups

- Refactor the 4 existing `categoryCodeById` page copies onto `loadCategoryCodeById`.
- Project name missing from PR card/detail header (procurement spans projects) — surfaced
  during the 2026-07-12 review; separate spec if wanted.
- Green `ตรงกับงาน` on the grid (amber-only shipped) — cosmetic, operator call.
