# Spec 180 — Purchase request item is catalog-only + searchable

Status: SHIPPED to prod — 2026-06-23 (U1 catalog-only searchable picker; U2
pro-max bottom-sheet picker — operator "UX is weird, uxui pro max").
Builds on: spec 179 (PR links a catalog item), spec 175 (catalog master + the
`/catalog` settings screen + `create_catalog_item`, BACK_OFFICE-gated; U4 images).

## U2 — pro-max picker (operator UX feedback, 2026-06-23)

The U1 inline search dumped all ~71 items in an always-open list under the field
(a wall that shoved the form down). Operator: "UX is weird, any better ones?
uxui pro max." → AskUserQuestion chose **full pro-max**. New
`CatalogItemPicker` (`catalog-item-picker.tsx`) in the app's BottomSheet idiom
(same as เบิก / stock): a trigger (`เลือกวัสดุจากแคตตาล็อก`) opens a sheet with a
pinned search (`ค้นหาวัสดุ`, autofocus), **category filter chips** (RadioChip —
the `/catalog` "select category first" pattern, spec 175 U6), and **thumbnail
result rows** with the matched substring highlighted; picking closes the sheet
and shows a chip (thumbnail + name + category · unit + `เปลี่ยน`). No-match → the
register CTA → `/catalog`. **Thumbnails**: both WP pages now select
`catalog_items.image_path` and mint signed URLs (`mintSignedUrls` +
`CATALOG_IMAGES_BUCKET`); `PurchaseRequestCatalogItem` gains `thumbnailUrl`. No
DB change (image_path exists since spec 175 U4). The form keeps `catalogItemId` +
derives description/unit; the picker owns the search/category/sheet state.

## Problem / operator requests (2026-06-22)

After spec 179 made catalog items selectable, the operator gave two refinements:

1. "Anything outside of catalog will need to be registered first." → the PR item
   is now **catalog-only**: the free-text escape hatch (`นอกแคตตาล็อก`) is removed.
   An item that isn't in the catalog must be **registered first** — and that
   registration is a **Settings activity** (operator: "must register on setting"),
   i.e. at `ตั้งค่า → แคตตาล็อก` (`/catalog`, spec 175). No inline add in the PR
   flow.
2. "Typing in item selection searches through catalog." → the picker becomes a
   **search box** (typeahead) over the catalog, replacing the grouped `<select>`.

## Decisions

- **Catalog-only, enforced at the form** (the requester surface). The DB
  `catalog_item_id` column stays nullable — legacy rows, the AppSheet writer, and
  the on-site cash purchase (`record_site_purchase`) all create rows without a
  catalog link; the validator stays lenient (uuid-or-null) to match that. The
  "must pick a catalog item" rule lives in the form's submit gate + the absence
  of any free-text item input (the `needed_by`/`priority` UX-only posture,
  ADR 0026). A picked item drives `item_description` (`baseItem` + ` specAttrs`)
  and `unit` as an immutable snapshot — the หมายเหตุ note field still carries any
  brand/model refinement.
- **Registration stays in Settings.** No inline "add to catalog" in the PR form.
  When a search finds nothing, the picker shows a hint pointing at
  `ตั้งค่า → แคตตาล็อก` (a link, useful to the curators — PM/super/procurement;
  site_admin is not a catalog curator and asks a curator to register, matching
  spec 175's BACK_OFFICE curation gate). This preserves the curated, anti-drift
  catalog (the whole point of spec 175).
- **Search is dependency-free** (no combobox/cmdk primitive exists in the repo):
  a controlled text input filters the catalog by a normalised `contains` over
  `baseItem + specAttrs + unit`; results render as a short clickable list;
  selecting shows a read-only chip with a `เปลี่ยน` (change) action.

## Units

### U1 — catalog-only searchable picker on the PR form

- `PurchaseRequestForm`'s `catalogItems` prop becomes **required** (every PR form
  now needs the catalog — both callers already pass it).
- Remove the free-text `รายการวัสดุ` input, the `หน่วย` dropdown + the `อื่น ๆ`
  unit-other input, and the grouped catalog `<select>`. Remove the now-unused
  `COMMON_UNITS` / `UNIT_OTHER_VALUE` machinery from the form.
- New search UX: when no item is chosen, a `ค้นหาวัสดุจากแคตตาล็อก` text input +
  a filtered result list (`baseItem · specAttrs (unit)`, category label as a
  subtitle). Selecting sets `catalogItemId`; `item_description` + `unit` derive
  from the chosen item. A chosen item renders as a read-only chip + `เปลี่ยน`.
- No-match state: `ไม่พบ "<query>" — เพิ่มวัสดุที่ ตั้งค่า → แคตตาล็อก` with a
  link to `/catalog`.
- Submit is gated on a chosen catalog item (plus the existing quantity / reason
  rules). `quantity` + `needed_by` + `priority` + `reason` + `notes` + the
  attachment stager are unchanged.

## Verification

- `purchase-request-form-catalog.test.tsx` (rewritten): typing filters the list;
  selecting a result shows the chosen chip + enables submit; there is **no**
  free-text `รายการวัสดุ` input; a no-match query shows the Settings hint/link.
- `purchase-request-form-priority.test.tsx` / `…-reason.test.tsx` (updated):
  drive the form by searching + selecting a catalog item instead of typing the
  item + unit, then assert the priority / reason behaviour as before.
- `createPurchaseRequest` still receives `catalogItemId` (spec 179) + the derived
  `itemDescription`/`unit`; the validator is unchanged (catalogItemId stays
  optional at the shared shape — the form enforces required).
- `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm build`. No DB change → no
  migration, no db:test delta.

## Out of scope (follow-ups)

- Applying catalog-only to `record_site_purchase` (the on-site cash buy is a
  different, ad-hoc SA flow — left free-text unless the operator extends the rule).
- An inline "add to catalog" from the PR flow (operator chose Settings-only).
- Keyboard arrow-key navigation of the result list (click + type is enough at the
  current catalog size; revisit if the catalog grows large).
- Making `catalog_item_id` NOT NULL / required in the validator or DB (kept
  nullable for the non-form create paths).
