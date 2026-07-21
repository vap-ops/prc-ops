# Spec 336 — category-derived งานย่อย codes (`W05-01`, retiring `WP-`)

**Status:** operator directive 2026-07-21 — "we don't use WP as code anymore,
redesign", then chose the work-category scheme over dropping codes from the UI.
Supersedes spec 335's D4 (parent-code prefix). One unit, **schema + code**.

## Problem

`WP-13`, `WP-13-04` carries no meaning: the number is a bare sequence, and the
`WP` prefix says only "work package", which every row already is. Meanwhile the
project already holds a real taxonomy — `project_categories` W01 งานเตรียมการ &
รื้อถอน · W02 งานโครงสร้าง · W03 งานสถาปัตยกรรม · W04 งานระบบประปา & สุขาภิบาล ·
W05 งานระบบไฟฟ้า & สื่อสาร · W08 งานภายนอก & ผังบริเวณ … — which is how the
operator actually talks about work. Spec 335 then prefilled new codes from the
parent's code, which propagates the dead convention.

## What the live data says (queried 2026-07-21, PRC-2026-004 + all projects)

| Fact                                                                                                                                         | Consequence                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **47 of 47** งาน carry a `category_id`; **47 of 47** have children in exactly ONE category, and **zero** children differ from their parent's | The parent งาน always determines the category — the sheet never has to ask.                                                                     |
| 385 of 396 codes are `WP-*`; the other 11 are a legacy solar project (`SL-001`, `WP01`…`WP09`)                                               | No existing code collides with a `Wnn-nn` scheme.                                                                                               |
| `work_packages.code` is **NOT NULL**, unique per `(project_id, code)`                                                                        | A code must always exist, and numbering must be **per project + category** — per-งาน numbering would collide across two งาน sharing a category. |
| `create_work_package` has no category argument; 17 of 349 leaves have a null category                                                        | Without a schema change the new code would claim `W05` on a row with no category — the code would lie.                                          |

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **A งานย่อย's code is `<category code>-<NN>`**, zero-padded, next free number within the project + category. `W05-03`.                                                                                                                                                                                                                                                                                                                                                          |
| D2  | **The category comes from the parent งาน, never a new question.** 47/47 groups already determine it; asking would be a question with one possible answer.                                                                                                                                                                                                                                                                                                                       |
| D3  | **The new row is CREATED with the parent's category** — `create_work_package` gains a trailing `p_category_id uuid default null`, DROP+CREATE from the LIVE body, exactly as 270 U4 added `p_parent_id`. Without it a row whose code reads `W05-03` would be created with a NULL category (17 of 349 leaves are in that state), so the suggested code would describe a category the row does not hold. Validated same-project AND active, matching `set_work_package_category`. |
| D4  | **Suggestion, not law.** The field stays editable and no DB constraint ties a code to its category. Unlike 335 the suggestion is a COMPLETE code, not a partial prefix, so it is submittable untouched — 335's "must differ from the prefill" guard is dropped, or the one correct answer would be the one string the user could not submit.                                                                                                                                    |
| D4b | **The stored category follows the PARENT, not the typed code.** A user who hand-edits `W05-03` to `W02-07` still gets the parent's category, because the งาน is what determines it (47/47 in live data) — the code is a label, the parent is the fact. So a hand-edited code CAN disagree with the stored category; the code is the thing that is then wrong, not the row.                                                                                                      |
| D5  | **Forward-only. No row is recoded.** The 385 legacy `WP-*` codes stay as they are, so a งาน can hold `WP-04-01…49` beside a new `W02-01`. Recoding live rows is an operator decision, not a side effect of this unit — see Open.                                                                                                                                                                                                                                                |
| D6  | **Group (งาน) codes are untouched.** Only leaves get the new scheme; recoding groups would break the `WP-05 › WP-05-03` breadcrumb shape and is part of the same operator decision.                                                                                                                                                                                                                                                                                             |

## Unit U1

- **Migration `075823`** (additive): `create_work_package` += `p_category_id` and
  new read-only `suggest_work_package_code(p_project_id, p_category_id)` —
  SECURITY INVOKER so the caller's RLS is the gate, and one round trip so the
  group branch gains no waterfall.
- **`075824`**: closes the anon-EXECUTE hole `075823` left — `revoke execute …
from anon` does NOT remove Postgres's default PUBLIC grant; the repo pattern is
  `revoke all … from public, anon`. The `229` lockdown pgTAP caught it.
- **`075825`** (review fixes): `lpad` truncation past 99, an unescaped `pc.code`
  reaching the regex engine, `::int` overflow on a long hand-typed run, and the
  inactive-category parity gap with `set_work_package_category`. Adds
  `comment on function` to both and corrects the `category_id` column comment.
- `add-work-package-sheet.tsx`: `fixedParent` gains the suggested code and the
  category it implies; the payload carries `categoryId`.
- The WP-detail `is_group` branch resolves the suggestion alongside its existing
  reads and passes it down.

## Testing

- pgTAP: category validated against the project · the row is created WITH the
  category · the suggester returns the next free number, skips taken ones, and
  starts at `01` for an unused category.
- vitest: the sheet prefills the suggestion and submits `categoryId`; a งาน with
  no category falls back to today's behaviour rather than blocking the create.

## Open — operator decisions, deliberately not taken here

**Codes lose parent locality.** Numbering per project + category means the three
W05 งาน in TFM all suggest `W05-01` right now; whoever creates first takes it and
the next gets `W05-02`, so a code no longer says which งาน it belongs to — the old
`WP-12-01` did. This is inherent to a category-numbered scheme under
`unique(project_id, code)`: the only way to keep locality is to put the งาน back
into the code (`W05-12-01`), which is the old shape wearing a new prefix. Worth a
look once the operator has created a few by hand.

**Recode the 385 legacy `WP-*` rows?** Leaving them means mixed codes inside one
งาน for a while. Recoding them is a data migration over live rows that the PDF
reports, purchase requests and every worklist display read. Cheap to do later,
expensive to undo — so it waits for an explicit call.
