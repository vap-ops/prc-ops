# Spec 327 — Procurement selection-first nav + S/T/R as project views

- **Status:** Design approved in chat 2026-07-18 (operator, with visual mockup);
  omotenashi directive applied ("looks good, apply omotenashi")
- **Supersedes:** spec 323's STR-as-menu-taxonomy semantics for the three middle
  tabs and its D3 (project lens = filter-only). The 5-tab spine, tab labels, the
  `/procurement` route family, the ticket queue, and every door survive.
- **Amends:** spec 326 (the โครงการ door remains until U6 re-homes the door grid)

## §0 Omotenashi test (binding, from spec 325)

Every unit in this spec must **carry a burden for the user, never hand them
one**. Concretely, in this spec's scope:

1. **No silent drops.** A WP without dates, a PR line without `eta`, a project
   with zero open PRs — each appears in a labeled bucket (ยังไม่กำหนดวันที่ /
   ไม่ทราบวันถึง / a card with zero counts), never vanishes from a view. Silent
   filtering is the zeeparn invisible-filter trap class (#621 fresh-eyes 🔴).
2. **Alerts carry their action.** A late-risk row opens the exact PR/PO it warns
   about, pre-scoped — one tap from problem to fix surface. A readiness gap
   names what is missing (ยังไม่สั่ง: list), not just a percentage. An
   equipment-period gap offers the extend/record-rental door.
3. **Empty states are doors.** ขอบเขต's "ยังไม่มีแผนจัดหา" chip opens
   supply-plan creation for that WP (procurement is in SUPPLY_PLAN_ROLES); the
   Resources labor slot states its deferral honestly (dashed, "รอข้อมูลทีมช่าง")
   rather than pretending or hiding.
4. **Selection costs zero in the common case.** Sole-project world: auto-select,
   land inside the workspace, no picker. Selection is sticky (cookie) across
   visits; ทุกโครงการ is one tap away, never a dead end.
5. **Degrade gracefully, state the grain.** Stock is project-grain
   (`stock_on_hand`); WP-level readiness says so rather than faking precision
   (coverage = plan lines vs project stock + line-item POs, labeled as such).

A unit that fails any of these in review does not ship.

## Problem

Spec 323 organized procurement's surfaces into S/T/R **buckets** — a filing
taxonomy (reports under Time, payroll under Resources) — with the project lens
as an optional, easily-invisible filter. Three "cannot find X" reports in one
week (#612/#621/#622) and the WP-list gap (spec 326) showed the taxonomy does
not match how the team thinks. Meanwhile project #2 is on the punch-list: the
single-project assumptions are about to break.

The operator's model (2026-07-18): **users default to making a selection first**
— one project, or all tickets together — and S/T/R are the three questions
procurement asks OF a selected project:

- **ขอบเขต (Scope)** — what work exists → the WP list
- **เวลา (Time)** — will supply land before work needs it → WP timeline ×
  deliveries
- **ทรัพยากร (Resources)** — are materials/equipment/labor ready → readiness

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Selection-first.** หน้าหลัก = dashboard whose project cards ARE the selection. Tap card → project workspace; S/T/R tabs render that project's views. Sticky (`procurement_project` cookie), sole-project auto-selected, ทุกโครงการ = explicit no-selection state. **Retires 323 D3** (lens = filter-only) — recorded reversal, second after spec 326.                                                                                                                                                    |
| D2  | **S/T/R re-semanticized from door buckets to project views** (contents below). Tab labels and the 5-tab spine are unchanged — 323's abstract labels already read as views.                                                                                                                                                                                                                                                                                                                                 |
| D3  | **All-projects mode is hybrid by view** (operator choice): Scope is project-only (an all-WP list is noise); Time works at both grains (portfolio delivery radar = the dashboard's alert block, project timeline = the tab); Resources is project-grain first (store-first doctrine: stock lives per-project คลัง). ทุกโครงการ keeps the spanning ticket queue.                                                                                                                                             |
| D4  | **Ticket queue untouched in v1.** `/requests` worklist + orders + incoming keep their current form and lens; reachable from dashboard cards and a จัดซื้อ door. Placement revisited only after the workspace proves itself (prove-value doctrine).                                                                                                                                                                                                                                                         |
| D5  | **Doors re-home, none die.** Every existing door (ทะเบียนวัสดุ, เทมเพลตแผนจัดหา, ผู้ขาย, ช่างรับเหมา, อุปกรณ์, เช่าอุปกรณ์, รายชื่อช่าง, ค่าแรง, ค่าใช้จ่าย, รายงาน, ต้นทุนโครงการ, แผนจัดหา; จัดซื้อ/ใบสั่งซื้อ/ของเข้า stay queue-family per D4; the spec-326 โครงการ door is subsumed by selection itself) moves to a compact เครื่องมือ row on หน้าหลัก with a one-tap full grid (ทั้งหมด). The term-SSOT work (#612/#621/#622) carries over verbatim. The door-grid section pages retire in U6, last. |
| D6  | **Labor readiness deferred honestly.** Roster is empty (awaiting เล็ก's crew + spec-306 muster adoption). The Resources view shows a dashed labor slot naming the deferral; no fake data, no hidden slot.                                                                                                                                                                                                                                                                                                  |

## The views (v1 content)

**หน้าหลัก — dashboard/selection.** Cross-project alert strip (late-risk count,
arriving-today count — the portfolio Time radar); project cards with per-project
counts (ขอซื้อ open, ของเข้าวันนี้, เสี่ยงช้า); ทุกโครงการ row → spanning queue;
เครื่องมือ door row. **Cards source the FULL visible project list** — a
zero-open-PR project shows a zero-count card (fixes the #621 known limitation;
plan-first means empty projects are exactly where procurement starts).

**ขอบเขต — WP list + supply overlay.** The selected project's WP list (read
path per spec 173) wearing procurement chips per WP: open-PR count, incoming
count, next-arrival date; late-risk rows red with the conflict stated
(ของถึง X — งานเริ่ม Y); fully-stocked rows green; no-plan rows carry the
create-plan door (§0.3). Without the overlay this view would duplicate
`/projects/[id]` — the overlay is its reason to exist. No selection → picker
prompt, one tap.

**เวลา — timeline × deliveries.** Three sub-views (operator-picked anchors):
เสี่ยงช้า (late-risk list: PR/shipment `eta` after WP `planned_start`; each row
opens its PR/PO), สัปดาห์นี้ (week radar: arrivals × WPs starting/running), and
ไทม์ไลน์ (visual: WP bars from `planned_start/end`, delivery pins from `eta`,
mobile-first vertical WP rows on a horizontal time axis with the
`[touch-action:pan-x_pinch-zoom]` pair). Undated WPs sit in a
ยังไม่กำหนดวันที่ shelf below the timeline (§0.1); no-eta lines in a
ไม่ทราบวันถึง bucket. Portfolio grain lives on the dashboard as the alert strip.

**ทรัพยากร — readiness.** Per WP: material coverage = supply-plan lines
(`supply_plan_lines.work_package_id`) vs project stock (`stock_on_hand`,
project-grain — labeled) + incoming POs for those items, shown as
ในคลัง / กำลังมา / ยังไม่สั่ง split with the ยังไม่สั่ง items named (§0.2);
project-level plan lines (null WP) in a project bucket. Equipment: active
rental batches (`starts_on`/`ends_on`) vs project period; a batch ending before
`planned_end` flags amber with the rental door beside it. Labor: D6 slot.

## Data grounding (live DB, 2026-07-18)

- `work_packages.planned_start/planned_end`: **331/395 filled (84%)** — timeline viable now.
- `purchase_requests.eta`: **386/447 (86%)**; `needed_by`: 65/447 (15%) → v1 late-risk compares `eta` vs WP `planned_start`; per-line need-dates are a later capture spec.
- PO shipments carry `eta`; `equipment_rental_batches.starts_on/ends_on`; `stock_on_hand(catalog_item_id, project_id, qty_on_hand)`; `supply_plan_lines(work_package_id nullable, catalog_item_id, qty)`.
- **No schema change in v1.** All views compute from existing tables.

## Units (each ships alone; queue + existing surfaces work throughout)

| Unit | Content                                                                                                                            | Notes                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| U1   | Selection shell: sticky cookie + sole-project auto-select + dashboard cards from the FULL project list + alert strip (counts only) | Fixes #621 zero-PR-project gap; หน้าหลัก layout lands here |
| U2   | ขอบเขต = WP list + supply overlay + create-plan empty-door                                                                         | Replaces the scope door-grid page for the tab target       |
| U3   | เวลา: late-risk list + week radar (+ dashboard alert strip becomes tappable into them)                                             | List views first — cheap, actionable                       |
| U4   | เวลา: visual timeline + undated shelf                                                                                              | The expensive screen; after U3 proves the data             |
| U5   | ทรัพยากร: materials coverage + equipment period check + labor D6 slot                                                              | Grain labels per §0.5                                      |
| U6   | Doors re-home to หน้าหลัก เครื่องมือ row + retire door-grid section pages + spec-326 door folds in                                 | Last, after all views exist; nav-guard updates land here   |

## Non-goals

- Labor readiness (D6), `needed_by` capture UI, supplier-slippage report (a
  future รายงาน item), any other role's nav, any schema change, queue
  relocation (D4), global switcher outside procurement (323 D3 stays for
  everyone else).

## Verification checklist (per unit + final)

1. Suite + guards green (bottom-tab pins, nav-back, site-map, ui-conventions §12 update in U6).
2. SSR-probe as view-as procurement: sole-project auto-select lands in workspace; ทุกโครงการ reachable; every §0 bucket renders (undated WP, no-eta line, zero-PR project card).
3. Late-risk row tap → the exact PR detail, pre-scoped.
4. Timeline horizontal scroll carries the touch-action pair (guard).
5. Zero console/server errors; grain labels present on Resources.
