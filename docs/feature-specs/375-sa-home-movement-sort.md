# Spec 375 — SA home: sort by movement, not by alphabet

**Status:** DRAFT — designed with the operator 2026-07-29, not yet planned or built.
**Origin:** operator, 2026-07-29 — _"redesign sa home"_, then _"why not have เบิกวัสดุ next to เบิกอุปกรณ์?"_. Layout directions explored in Claude Design (Opus 5); shape **2b** chosen by the operator.
**Siblings:** [spec 370](370-equipment-scan-in-out.md) U4 shipped the scan door onto this page (#843) — §3 U3 re-homes it into the custody pair rather than leaving it a lone hero. [spec 366](366-wp-zones.md) is the prerequisite for the location-first direction this spec explicitly defers (§5.3).

---

## 1. The problem, measured live

`/sa` is where the site admin's day starts, and it ends in a wall.

| Signal (prod, 14 days unless noted, 5 real `site_admin` users) | Value                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/sa` route views                                              | **810** — the #2 route in the app                                         |
| Sessions that _begin_ on `/sa` (`session_start`)               | **511**                                                                   |
| Top exits from `/sa`                                           | WP detail **275** · `/projects` **207** · project hub **188**             |
| `งานของฉัน` rows rendered                                      | **139**                                                                   |
| …their sort                                                    | `projectCode` then WP `code` — **alphabetical**                           |
| Composition of those 139                                       | 34 `in_progress` · 105 `not_started` · 1 `rework`                         |
| Photos in 14d, by status                                       | `in_progress` **170** · `pending_approval` **346** · `not_started` **23** |
| The SA's actual act                                            | **1,349 photos** across **165 WPs**                                       |
| Distinct WPs photographed per day                              | **1–51**, median **13** (10d)                                             |

Three defects fall out, and one popular theory is refuted.

### 1.1 The sort is the defect — and the app's own ranking SSOT cannot fix it

`src/lib/sa/my-work.ts` sorts by project code then WP code. There is no relevance signal at all: a WP photographed an hour ago and one untouched since 07-07 sit in whatever order their names imply.

The app already owns a ranking lens — `src/lib/work-packages/action-bands.ts` (`deriveActionBand` + `rankFromPriority`, bands `ต้องทำเลย · พักงานชั่วคราว · รอ PM ตรวจ · เสร็จแล้ว`), consumed by `/projects/[projectId]` and `worklist-row.tsx`. **The SA home never adopted it.** But adopting it verbatim would not help either, for two measured reasons:

- `deriveActionBand` maps **both** `not_started` and `in_progress` to the `todo` band — so the 139 rows collapse into ONE band of 139, exactly the wall we have.
- `rankFromPriority` consumes `work_packages.priority`, and **all 177 open leaf WPs are `priority = 'normal'`**. The rank is a constant. The mechanism has never been used by a human.

So the only relevance signal that exists today is **derived activity**. That is not a preference; it is the only input with variance.

### 1.2 ~~A single-project SA has no door to her own project~~ — WITHDRAWN 2026-07-30

**This defect was not real, and the unit built from it (U2) has been reverted.** Kept in place rather than deleted, because the way it was wrong is the useful part.

The original claim: `CurrentProjectSwitcher` renders nothing below 2 projects, all 5 SAs are single-project, therefore the home has no project link, therefore **395 of ~810 visits leak sideways** into `/projects` (a 4-item list, 3 of them empty) — a two-tap detour. Three errors:

1. **The tab already goes straight there.** The SA's `โครงการ` tab points at `/projects`, and [spec 313 U4](313-nav-map-redesign.md) already redirects a `site_admin` from there to her project hub (`saProjectsLandingTarget`, with `?view=all` as the escape). One tap, shipped since 2026-07 — verified in-browser: as `site_admin`, `/projects` returns a `NEXT_REDIRECT` payload naming the hub and renders no list.
2. **The "leak" was a telemetry misread.** An RSC redirect logs a `route_view` for BOTH `/projects` and the destination hub, so **one tap emits two events**. The 207 + 188 pair is the same journey counted twice, not a detour.
3. **The "4-item list, 3 empty" was `dev-preview`'s super_admin view.** Every real SA has 1 membership and 0 lead-of rows, so their list has exactly ONE item.

Operator verdict, which was right on all counts: _"I don't see the point of putting my project on top, redundant nav with bottom menu."_

⭐ **Carries:** a page's contents are **principal-relative** — never describe what a role sees from what a super_admin test account sees. And **a redirect inflates route-view counts**; before reading consecutive route views as a multi-tap journey, check whether the first one redirects.

### 1.3 The red `แจ้งปัญหา` FAB is permanent rent for a feature nobody uses

`site_issues` has **0 rows in 30 days**. `ReportIssueFab` is `fixed`, unconditional, and stacked directly above the camera in the thumb zone.

### 1.4 Refuted: "the empty sections are the problem"

The first read of this page blamed the conditional sections that are empty on most days — `แผนวันนี้` (3 plans / 33 items in 30d), the muster strip (6 muster days in 30), `ปัญหาวันนี้` (0 issues in 30d). **All three already `return null` when empty.** They cost zero pixels on a typical day. Demoting them wins nothing and would delete three working doors. Recorded here so the next session does not re-propose it.

---

## 2. Design — one list, ordered by movement

The chosen shape (Claude Design **2b**). The principle, in the operator's frame: **the cold set is never filtered away, it is demoted.**

### 2.1 ~~Project block, first in the body~~ — BUILT (#846), then REVERTED (#849)

Shipped 2026-07-30 and removed the same day on the operator's call. See §1.2 for why the premise was false: the `โครงการ` tab already lands on her hub in one tap, so the block was a second project affordance beside an existing one. `CurrentProjectSwitcher` keeps its pre-existing behaviour (multi-project only) — the revert restores the page to exactly that.

**Do not re-propose this without new evidence.** An absence pin in `sa-home-movement-wiring.test.ts` reds if the card returns.

### 2.2 One continuous list, sorted by movement

- Sort key: `greatest(last photo created_at, work_packages.updated_at)`, newest first. Photos alone would sink a WP worked through labor or a purchase request; `updated_at` alone is coarser (16 of 34 `in_progress` fresh in 7d vs 20 of 34 by photo).
- **The sort is stated out loud** in the section header (`เรียงตามรูปล่าสุด`). An unexplained order is an order the field cannot trust.
- A **labelled rule** marks where the cold set begins: `ไม่มีรูปใน 14 วัน · N งาน`. Rows continue below it — dimmed, still tappable, nothing removed.
- Cold rows render in **neutral ink**. Coldness is a state, not an alarm. (See §5.1 for what red is _not_ used for.)
- No cap, no truncation, no tab switch. The 139 stay on one surface in an order that means something.

### 2.3 Per-row capture

Each row carries its own 44px camera chip → `#wp-photos` on that WP. The floating `CameraFab` **stays** and keeps its full picker domain (§5.4) — it stops being the _only_ capture path rather than being replaced.

### 2.4 `เบิกจากคลังหน้างาน` — the custody pair

One heading over one bordered container, split down the middle:

| `เบิกวัสดุ` → `/projects/:id/store` | `เบิกอุปกรณ์` → `/equipment/scan` |
| ----------------------------------- | --------------------------------- |

The site admin has custody of both, and both are withdrawals from the same physical store ([SA custody doctrine](../../CLAUDE.md), store-first flow). Today they are unrelated: materials is a generic `คลัง` tile and equipment has barely any entry point — over 7 days a `site_admin` generated **4** route events on `/equipment*` against **21** on the project store, and **`equipment_usage_logs` is still 0 rows across 64 `equipment_items`**. (Re-measured 2026-07-29; the lane-370 LANES block quotes 2 and 20 for the same window — do not inherit those.)

**One door only.** The existing `คลัง` tile is _renamed into_ the left half — there is no second materials tile (the spec-313 U3 lesson that retired the duplicate `ทีมงาน` tile). `คลัง` survives as the **destination** noun in the hub row and bottom tab; the withdrawals are the **actions**. The equipment half carries a scan glyph in neutral ink so it never competes with the amber shutter.

⚠️ **The counts were DROPPED at build time (U3, 2026-07-30) — spec 370 was right, not stale.** This section originally required both halves to show a count, `ยืมอยู่ 0 ชิ้น` included, against the `equipment-scan-door` comment that had explicitly refused counts on `/sa` for cost. Gate-checking the predicate settled it: an open loan is **not** `checked_in_on is null and superseded_by is null`. It is the supersede **anti-join** — candidates with `checked_in_on is null`, minus every row _pointed at_ by another row's `superseded_by` (ADR 0009; the new row points at the old). A correct count therefore needs two row-reads plus in-memory filtering, which is exactly the read spec 370 declined to put on the app's heaviest page, and the naive form is the documented **wrong** read that resurrects closed loans as open. A wrong number on the SA's home is worse than no number, and the store page already does the anti-join and shows the real figures. The pair reads as a pair through its shared heading and container instead.

### 2.5 `แจ้งปัญหา` leaves the thumb zone

`ReportIssueFab` becomes a `เครื่องมือ` tile. The camera keeps the thumb zone alone. The reporting flow itself is untouched.

---

## 3. Units — all CODE-ONLY, no schema

| Unit   | Scope                                                                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1** | Movement sort + stated sort header + the cold rule. Replaces the alphabetical sort in `my-work.ts`; adds one aggregate read for last-photo-per-WP into the page's existing `Promise.all` wave (≤139 ids). |
| **U2** | ~~Project block~~ — **built #846, REVERTED #849** (§1.2/§2.1: the โครงการ tab already lands on the hub; premise was false). Sourced from `saCurrent.current.projectId`.                                   |
| **U3** | The `เบิกจากคลังหน้างาน` pair — renames the `คลัง` tile, re-homes spec 370's `EquipmentScanDoor` (shipped #843) into the right half, adds the counts.                                                     |
| **U4** | `ReportIssueFab` → `เครื่องมือ` tile.                                                                                                                                                                     |
| **U5** | Per-row camera chip (optional; the row already carries a `รูปถ่าย` ActionChip — this unit is a promotion, not a new affordance).                                                                          |

Order: U1 → U2 → U3 → U4 → U5. U1 and U2 are independent; U3 must land after #843 merges.

---

## 4. Non-goals

- **No new route.** 2b needs no `/sa/work` page — nothing is truncated, so nothing needs an overflow surface.
- **No change to the bottom tab bar or hub nav.** The redesign lives in the scrolling body between them.
- **No change to `แผนวันนี้`, the muster strip, or `ปัญหาวันนี้`** beyond §2.5's FAB move — see §1.4.
- **No new schema, no new column, no migration.** The schema lane is untouched.

---

## 5. Gate-checks — three designs refuted before build

### 5.1 `เกินกำหนด` (overdue) is dead on arrival — do NOT ship it

The mockups carried a red `เกินกำหนด` chip. Measured live: **175 of 177 open leaf WPs carry a `planned_end`, and all 175 are already past it.** The chip would fire on 99% of rows — a signal with no discrimination, rendered in the one colour reserved for genuine danger. Independently, [spec 363](363-wp-detail-sa-nav.md) records the operator's ruling: _no dates on the SA screen yet_ (220 of 350 leaf WPs past `planned_end` at that time). Red stays reserved.

### 5.2 `4/6 รูป` completeness — the denominator does not exist

The mockups showed per-row photo completeness. There is **no required-photo-count per phase anywhere in the codebase** (the only `REQUIRED` photo rules are ≥1 equipment condition photo and a few form-level ones). Either invent that rule deliberately as its own spec, or render a bare count. Do not ship a fraction whose denominator is fabricated.

### 5.3 Location-first is spec 366, not this spec

The most interesting direction (`อาคาร A · ชั้น 3` tiles showing hot/total) needs a spatial axis that **does not exist**: `work_packages` has no zone column, and the group tree is **trade-based** — `งานฐานรากและพื้นอาคาร` (49 children), `งานบ่อพักน้ำฝน` (22), `งานกระเบื้อง` (13), `งานแอร์` (7). Spatial information lives only as free prose inside leaf names (`งานวางบ่อพักด้านซ้าย (มองเข้าหน้าอาคาร)`), exactly as [spec 366 §1](366-wp-zones.md) records. That direction is a **post-366** design and should be revisited when zones ship. A buildable cousin — group tiles keyed on the existing `parent_id` hierarchy — is available today but is **not** in scope here.

### 5.4 The capture picker must keep the full set

`CameraFab` is fed the same `items` array the list renders. Under a truncating design this would silently shrink the picker from 176 to the cap — the class of defect where a "half that removes a signal" ships alone. **2b removes nothing**, so the hazard is answered structurally rather than by a guard. Any future capping unit must re-check this before touching the array.

⚠️ **SUPERSEDED 2026-07-31 (spec 384 U2):** the FAB is no longer fed `items` alone — `captureWps = buildCaptureWps(actions, items)` unions in the `ต้องแก้ไข` rows too (they were the picker's exact complement, spec 384 §1.4). The "same array" premise above is gone; the still-true half is "never truncate the picker's domain" — check `buildCaptureWps`, not `items`, before touching it.

### 5.5 Owed at build time

- **RSC boundary** — any constant shared between the (server) page and a client row component must live in a leaf module with no `server-only` and no DB imports. `src/lib/photos/current-photos.ts` is `server-only` and is **not** a home for shared types. (The spec-371 U2 `/dashboard` 500 that vitest could not see.)
- **`labels.ts` SSOT** — every new user-facing term (`เรียงตามรูปล่าสุด`, `ไม่มีรูปใน 14 วัน`, `เบิกจากคลังหน้างาน`, `เบิกวัสดุ`, `เบิกอุปกรณ์`) is used in 2+ places and belongs in `src/lib/i18n/labels.ts`. Check against the existing `STORE_LABEL = "คลัง"` and `STORE_ISSUE_LABEL = "เบิกออก"` before minting a near-duplicate.
- **Guard-trip map** — the tools grid, `SaTools`, and any settings-section change have CI guards; check `prc-ops-guard-trip-map` before editing.
- **Store-page gate** — `canReturnEquipment` gates the store's own scan door. Confirm the pair's equipment half needs no additional gate on `/sa`: `SA_SURFACE_ROLES ⊆ EQUIPMENT_MOVE_ROLES` is pinned in `role-sets.test.ts` (spec 370 U4), so a gate would be an unreachable arm.
- **Sort must be pinned behaviourally, not by source scan.** The whole unit is the ordering; a `toContain` on a helper name proves only that it is imported. Iterate a fixture with known timestamps and assert the emitted order, then mutation-check by reverting to the alphabetical comparator.

---

## 6. Open decisions

1. **Cold threshold.** `ไม่มีรูปใน 14 วัน` is the drawn value. 14 days matches the telemetry window but is otherwise arbitrary; 7 would put ~14 of 34 `in_progress` rows below the rule.
2. **Pair treatment.** Claude Design offers three (split-half light · stacked-rows dark · 2px high-contrast). Operator picks one and it applies across the page.
3. **`ค้างถ่ายรูป` as a headline count.** If it earns a number in the project block, it needs a definition. Proposed: _`in_progress` WPs with no photo today._
