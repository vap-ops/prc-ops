# 393 — Bar bending schedule (ใบดัดเหล็ก)

**Status:** spec only · **Owner:** CC · **Created:** 2026-08-04

Operator, 2026-08-04, handing over a photographed notebook page: _"maybe also use it with drawing drafts if needed"_ — a hand-drawn ⊓ profile, `35 / 45 / 35`, `18 ตัว`, `115 = 180 กก`, and below it `20 / 120 / 20`, `10 ตัว`, `160 = 100 กก`.

Asked what the app must do with it, the operator chose **"be read and printed on site"** and, for the weight, **"compute, but warn only"**.

---

## 1. The decision — the numbers are the payload, the drawing is output

A photographed sketch keeps the picture and throws away the data. Everything the shop needs — leg lengths, count, diameter, total weight — is numeric, and every one of those numbers is currently trapped in a notebook.

So the app stores **rows**, and **renders** the shape from them. Consequences that follow only from this ordering: the sheet is correctable without redrawing, totals are summable, and a schedule can be printed per zone rather than per scrap of paper.

⛔ **Not** a drawing surface. [392](392-project-zone-maps.md) argues for a canvas where the artifact is a _layout_ that repeats across projects; a bending schedule is a _table_, and drawing it by hand would feed nothing downstream.

Deliberately out of scope, both offered and declined by the operator:

- **Purchasing** — no rollup of tonnage into a ขอซื้อ. Keeps this spec off the money paths.
- **Fabrication workflow** — no ordered → cut → bent → delivered states, so no new field-facing surface to maintain.

---

## 2. Where it hangs

On the **work package**, not on the brief and not on the project.

- Not `wp_briefs`: brief versions are immutable published snapshots (`wp_brief_versions`), and a bending schedule is revised after publication. Wrong lifecycle. The `bar_schedule` (ใบดัดเหล็ก) entry already seeded in `wp_brief_attachment_types` stays what it is — a place to hang the scanned paper — and is not the structured home.
- Not the project: `prc-ops-wp-centric-principle` — site staff open a WP, not a document library.

Printing is per WP **and** per zone once [392](392-project-zone-maps.md) lands, because the shop bends for an area, not for one WP.

---

## 3. Data model

**`wp_bar_schedule_lines`** — `id` · `work_package_id` → `work_packages` · `catalog_item_id` (nullable → `catalog_items`) · `material_label` (free text fallback) · `shape_code` (`bar_shape` enum) · `legs` `jsonb` (ordered lengths, cm) · `qty` · `cut_length_cm` (stored, entered or accepted) · `weight_kg` (stored, entered or accepted) · `note` · `created_by` · timestamps · `sort_order`.

Shape set v1: `straight` · `l_bend` (2 legs) · `u_bend` (3 legs, both sketches) · `custom`. The renderer is a pure function `(shape_code, legs) → SVG`, unit-testable with no DOM.

⚠️ **Make the render `switch` exhaustive with no `default:` arm.** A `default: return null` ships a new shape that renders nothing while typecheck stays green.

### 3.1 The weight rule

Typed value **wins and prints**. The app computes alongside it and flags a divergence over **3%**; it never blocks and never overwrites.

Worked against the operator's own sheet, at DB32 (6.313 kg/m):

| Line | Legs          | Qty | Length | Computed   | On the sheet | Result           |
| ---- | ------------- | --- | ------ | ---------- | ------------ | ---------------- |
| 2    | 20 / 120 / 20 | 10  | 16.0 m | **101 kg** | 100 กก       | agrees, 1%       |
| 1    | 35 / 45 / 35  | 18  | 20.7 m | **131 kg** | 180 กก       | **flagged, 38%** |

Line 2 pins the model: 100 kg over 16 m is 6.25 kg/m, which is DB32 to within a rounding. Line 1 at 8.7 kg/m matches no standard rebar size, so either the material differs or the arithmetic slipped — **exactly the case the warn-only rule exists to surface**, and exactly the case a blocking validator would have made unusable.

⭐ **Mass per metre comes from the catalog item, not from a constant in the code.** `catalog_items` already carries `spec_attrs`; a hardcoded `d²/162` table would drift from the material master the moment a grade is added, and this org has already run one catalog dedupe (spec 344).

When no catalog item is linked, there is no computed value and therefore **no flag** — the row prints the typed number silently. An absent comparison must never render as agreement.

---

## 4. Surfaces

- **WP detail** — a ใบดัดเหล็ก section: rows with the generated diagram, legs, qty, length, weight, and the divergence chip. Totals per sheet.
- **Editor** — manager-gated, same `is_manager(current_user_role())` + `can_see_wp` posture as `save_wp_brief_draft`, `42501` on refusal.
- **Print** — a print stylesheet, not a PDF generator. `pdfkit` is already a dependency but it is server-side and used for reports; a print view costs nothing and matches what a shop actually does with a phone and a printer.

⚠️ Any horizontally scrolling row needs `[touch-action:pan-x_pinch-zoom]` (`prc-ops-touch-action-scroll-rows`).

---

## 5. Units

| U   | Scope                                                                                        | Schema  |
| --- | -------------------------------------------------------------------------------------------- | ------- |
| U1  | Table, `bar_shape` enum, RLS, `upsert_bar_schedule_line` / `delete_bar_schedule_line`, pgTAP | **yes** |
| U2  | Pure shape renderer + weight calculator, unit-tested against the two sketch lines above      | no      |
| U3  | WP detail section + editor                                                                   | no      |
| U4  | Print view, per WP and per zone                                                              | no      |

---

## 6. Acceptance

- Rows exist for a real WP within 14 days of U3, entered by someone other than the operator's admin account.
- **The divergence flag fires at least once and blocks nobody** — if it never fires across a real sheet, verify the comparison is actually running rather than assuming agreement (an absent catalog link produces no flag by design, and that is indistinguishable from agreement in a screenshot).
- One schedule printed and used on site. That is the whole point; a screen nobody prints from is spec 377's failure repeated.

---

## 7. Sibling

[392](392-project-zone-maps.md) — ผังโซนโครงการ, the first half of the same request. Independent; this spec gains print-per-zone once that ships.
