# Spec 327 — Procurement selection-first + S/T/R project views — Implementation Plan

> **For agentic workers:** each unit is one `ship-unit` PR (lane claim → dependency
> gate-check against LIVE form → TDD RED-first → real-browser verify → fresh-eyes
> review → `scripts/ship-pr.sh`). Steps use `- [ ]` for tracking. Build STRICTLY in
> order U1→U2→U3→U4→U5→U6 — every view unit consumes U1's selection, U4 slots into
> U3's host, U6 retires grids only after all views exist.
>
> Plan grounding: every file/line/column claim below was gate-checked against
> origin/main (`be425909`) and the live DB by an 8-agent fan-out + adversarial
> verify pass, 2026-07-18. Re-verify at each unit's Gate 1 anyway — main moves.

**Goal:** Procurement lands on a dashboard whose project cards ARE the selection; the
ขอบเขต/เวลา/ทรัพยากร tabs render that project's WP-supply, timeline, and readiness
views; every door survives; the queue is untouched (spec 327, §0 omotenashi binding).

**Architecture:** No new routes, no schema. The 5-tab spine, `/procurement` +
`/procurement/[section]` routes, and `parseProcurementSection` all SURVIVE — only
body content changes. `hub-body.tsx` is the shared render for BOTH the root page
(section=null) and the section pages, so U1 first FORKS the root branch into a
dashboard component; U2/U3/U5 then swap each section's body for a view component
(rendered ABOVE the door grid, which retires only in U6). Sticky selection =
`procurement_project` httpOnly cookie, blueprint = the SA current-project resolver
(spec 292). All view data reads via the RLS server client EXCEPT equipment
(zero-grant money tables → admin client behind the role gate, rentals-page
precedent).

**Tech Stack:** Next.js 16 App Router (Server Components default), Supabase RLS,
Vitest, Field-First tokens, `gantt-scale.ts` timeline math.

## Global Constraints (every task inherits)

- **§0 omotenashi (spec 327, binding):** no silent drops (labeled buckets for
  undated WP / no-eta PR / zero-PR project); alerts carry their action; empty
  states are doors; selection costs zero sole-project; grain honesty. A unit
  failing §0 in review does not ship.
- **Money surface:** views render COUNTS/dates only — never ฿. `stock_on_hand`
  reads select `catalog_item_id, qty_on_hand` (NEVER `total_value`); equipment
  reads select `starts_on, ends_on, status` (NEVER `monthly_rate`).
- **ADR 0065 anchor rule:** every PR→WP join uses
  `work_package_id ?? requested_from_work_package_id` (both columns exist,
  `database.types.ts:4925/:4914`; pattern `load-requests-data.ts:384`,
  `load-request-detail.ts:48`). Joining `work_package_id` alone silently drops
  every modern store-bound PR — a §0.1 violation and the highest-ranked
  correctness trap in this plan.
- **Late-risk SSOT (one definition, three consumers):** a PR in
  `ACTIVE_REQUEST_BANDS` with non-null `eta` whose anchor-WP has non-null
  `planned_start` and `eta > planned_start` (string compare, ISO dates). ALL
  active bands — not in_transit-only (an already-late PR still awaiting approval
  is the earliest actionable warning). v1 uses PR.eta only;
  `purchase_order_deliveries.eta` is a deferred refinement (it has no
  project/WP column — fan-out via purchase_orders adds complexity for 14% of
  rows).
- **Nav SSOTs frozen:** 5-tab spine + labels + routes unchanged through U5
  (`bottom-tab-bar.test.tsx:68-92`, `hub-nav.test.tsx:62-92`,
  `role-home.test.ts:45-75` stay GREEN untouched). U6 touches only
  `procurement-home.test.ts` pins, deliberately.
- **No new `page.tsx` anywhere** — `nav-back-affordance.test.ts:280` classifies
  every page; new/deleted routes churn it. View components co-locate under
  `src/app/procurement/` or `src/components/features/purchasing/` (allowed
  domain, `feature-components-structure.test.ts:12`). Section pages stay
  NON_DETAIL: never add a `DetailHeader` to them (`nav-back-affordance.test.ts:274`).
- **Field-First tokens only** (`design-doctrine.test.ts:48-59` RAW_HUE ban):
  late-risk red = danger tokens, readiness amber = attn/warning tokens via
  `status-colors.ts` / globals.css — never raw `red-*`/`amber-*`/`green-*`.
- **Terms:** reuse `ยังไม่สั่งซื้อ` (labels.ts:570 — do NOT mint the spec's
  shorthand ยังไม่สั่ง), `กำลังมา` (INCOMING_LENS_LABEL.onroute:259),
  `ของเข้าวันนี้`. Lift existing inline literals `ไทม์ไลน์`
  (schedule-views.tsx:39) and `ยังไม่กำหนดวันที่` (schedule-gantt.tsx:580) into
  labels.ts when U3/U4 make them 2+-place terms. New: `เสี่ยงช้า`,
  `ไม่ทราบวันถึง`, `สัปดาห์นี้` → labels.ts from first use.
- **Per unit:** update `docs/progress-tracker.md` (in-progress → complete) and
  the affected `docs/site-map.md` rows (manual doc-contract — no test enforces
  it; review does). TDD RED-first; Thai via Edit/Write tools; ship via
  `scripts/ship-pr.sh`; delete merged branches.

---

## Unit sequence

| Unit | Content                                                             | Risk                           | Depends on |
| ---- | ------------------------------------------------------------------- | ------------------------------ | ---------- |
| U1   | Selection shell + dashboard (cookie, full-list cards, alert counts) | code-only                      | —          |
| U2   | ขอบเขต = WP list + supply overlay                                   | code-only                      | U1         |
| U3   | เวลา = late-risk list + week radar (`?view=`)                       | code-only                      | U1         |
| U4   | เวลา = visual timeline + shelves                                    | code-only                      | U3         |
| U5   | ทรัพยากร = material coverage + equipment period                     | code-only (admin-client reads) | U1         |
| U6   | Doors → เครื่องมือ row; retire door grids; fold spec-326 door       | code-only (nav-guard churn)    | U2, U3, U5 |

Interim states are all coherent: after U1 the dashboard selects but section pages
still show door grids (reachable, strip-scoped); U2/U3/U5 put their view ABOVE
that section's door grid (รายงาน and friends stay reachable); U6 removes grids
last, having re-homed every door.

---

## Task U1: Selection shell + dashboard

**Why:** D1 selection-first + the #621 fix. Current
`buildProcurementProjectStatus` (procurement-home.ts:49-74) derives cards from PR
rows — zero-open-PR projects vanish (drops null-project :56, non-open bands :58,
name-unresolved :72), and its pins (procurement-home.test.ts:89-96) codify that.
Procurement RLS on `projects` returns ALL projects (migration 20260813071000:
`current_user_role() = ANY(procurement, procurement_manager) OR can_see_project`),
so the full-list source is one RLS read.

**Files:**

- Create: `src/lib/purchasing/procurement-project.ts` — pure:
  `PROCUREMENT_PROJECT_COOKIE = "procurement_project"` +
  `resolveSelectedProject(cookieValue: string | null, visibleProjectIds: string[]): string | null`
  (valid id → id; stale/garbage → null; exactly one visible project →
  auto-select it; else null = ทุกโครงการ). Blueprint:
  `src/lib/sa/current-project.ts` (spec 292 — same sole-project +
  validate-against-visible semantics).
- Create: `src/lib/purchasing/procurement-project.server.ts` — `server-only`
  cookie I/O mirroring `src/lib/sa/current-project.server.ts`: read with
  try/catch→null, set/clear httpOnly+secure+sameSite:lax+path:/.
- Create: `src/app/procurement/actions.ts` — `"use server"`
  `setProcurementProject(projectId)` → validate UUID + visibility, set cookie,
  `redirect("/procurement/scope")`; `clearProcurementProject()` → clear cookie,
  `redirect("/procurement")`. Precedent: `src/app/sa/current-project-actions.ts`.
  (Cookie write REQUIRES a server action — a Link/render can't set httpOnly.)
- Create: `src/lib/purchasing/late-risk.ts` — pure
  `selectLateRisk(prRows, wpById, todayIso)` returning flagged rows +
  `countLateRisk(...)` per the Late-risk SSOT constraint. Consumed by U1 count,
  U2 row state, U3 list — write it once here.
- Create: `src/app/procurement/dashboard-body.tsx` — server component: alert
  strip (เสี่ยงช้า count + ของเข้าวันนี้ count, portfolio grain) + project cards
  (name + ขอซื้อ n · ของเข้าวันนี้ n · เสี่ยงช้า n; zero-count cards render —
  the #621 assertion) as `<form action={setProcurementProject.bind(null, id)}>`
  submit buttons + selected-state ring on the current selection + ทุกโครงการ row
  (→ `/requests`, spanning queue) + the คำขอสมัคร nudge — MOVED here from
  hub-body's section=null branch (check hub-body.tsx:164-171: if the nudge also
  renders on section pages today, leave that arm; if it was null-only, this move
  keeps exactly one render site).
  Card count chips may deep-link `/requests?project=` as secondary affordances —
  the ?project= lens on spanning surfaces is NOT retired (cookie drives S/T/R
  views only; the two axes never fight because they scope different surfaces).
- Modify: `src/app/procurement/page.tsx` (:34-39) — section=null renders
  `<ProcurementDashboardBody>` instead of `<ProcurementHubBody section={null}>`.
  PRESERVE hub-body's exports (`PROCUREMENT_HOME_ROLES`, `ProcurementHubBody`) —
  `[section]/page.tsx:19` imports both; section pages must keep working.
- Modify: `src/lib/purchasing/procurement-home.ts` — add
  `buildDashboardCards(projects, prRows, wpById, todayIso)` (full-list LEFT-join;
  reuse `requestBand`/`ACTIVE_REQUEST_BANDS` + the arrivals-today rule at
  :61-63). Keep `buildProcurementProjectStatus` for the section-page strip until
  U6 removes it.
- Test: `tests/unit/procurement-project.test.ts`,
  `tests/unit/late-risk.test.ts`, extend `tests/unit/procurement-home.test.ts`.

**Interfaces:**

- Produces: `resolveSelectedProject`, `readProcurementProjectCookie()`,
  `setProcurementProject` action, `selectLateRisk/countLateRisk`,
  `buildDashboardCards`. U2/U3/U5 resolve their project via
  `resolveSelectedProject(readProcurementProjectCookie(), visibleIds)`.

- [ ] Gate 0: lane claim `327u1` (worktree). Gate 1: re-verify
      procurement-home.ts:49-74, projects RLS qual (live `pg_policies`), both PR
      anchor columns in `database.types.ts`.
- [ ] RED: `resolveSelectedProject` (4 cases above); `selectLateRisk` (counts
      eta>planned_start in active band; excludes eta≤start, null eta, null
      planned_start, done/closed band; INCLUDES a work_package_id-NULL /
      requested_from-set PR — the anchor-coalesce assertion);
      `buildDashboardCards` (zero-PR project yields a zero-count card).
- [ ] REWRITE deliberately: procurement-home.test.ts:49-52 (`procurementStripHref`
      — superseded by card-as-selection; delete helper + pin) and :93-96
      (all-done→[] pin — contradicts the #621 fix).
- [ ] GREEN minimal → full suite → SSR-probe view-as procurement: cards render
      incl. a zero-count project, tap sets cookie + lands on `/procurement/scope`,
      sole-project world auto-selects (no picker), stale cookie falls back to
      ทุกโครงการ (§0.4). Zero console/server errors.
- [ ] Fresh-eyes → ship → tracker + site-map `/procurement` row.

---

## Task U2: ขอบเขต — WP list + supply overlay

**Why:** the view that makes the tab earn its name. Reuses the spec-173 WP read
(`loadProjectDetail`, load-detail.ts:65 — already selects planned_start/end,
grouping, category) and aggregates PRs per WP.

**Files:**

- Create: `src/lib/purchasing/wp-supply-overlay.ts` — pure
  `buildWpSupplyOverlay(wps, prRows, plannedWpIds, todayIso)` → per-WP
  `{openCount, incomingCount, nextArrival, lateRisk, hasPlan}`. Anchor-coalesce
  join; `nextArrival` = min eta of in_transit PRs; `lateRisk` via
  `selectLateRisk` (U1 SSOT); `hasPlan` = WP id ∈ supply_plan_lines'
  work_package_id set joined through `supply_plan_id → supply_plans.project_id`
  (lines carry NO project_id — supply-plan/page.tsx:178 pattern). PRs with BOTH
  WP columns null are project-grain (store restock) — surface as one project-row
  bucket above the list (§0.1), not silently dropped.
- Create: `src/components/features/purchasing/scope-wp-list.tsx` — procurement
  variant list (do NOT bolt onto the SA/PM `work-package-list.tsx` — 3-lens
  shared component, procurement data doesn't belong there). Reuse
  `WpCategoryCode`, `StatusPill`, `EmptyNotice`, `workPackageHref`,
  `buildGroupedRoster`. Late-risk row: danger tokens + conflict text
  `ของถึง {formatThaiDate(eta)} — งานเริ่ม {formatThaiDate(planned_start)}`.
  No-plan chip links `supplyPlanHref(projectId)` (NewPlanButton lives there —
  §0.3; per-WP plan-create doesn't exist and is NOT built here).
- Modify: `src/app/procurement/hub-body.tsx` — section==='scope' renders
  `<ScopeView>` (server wrapper fetching loadProjectDetail + PR rows + plan-line
  set for the resolved project) ABOVE the existing scope door grid. No selection
  → one-tap picker prompt (reuse dashboard cards compact form).
- Test: `tests/unit/wp-supply-overlay.test.ts` + component test
  `scope-wp-list.test.tsx`.

**Interfaces:**

- Consumes: `resolveSelectedProject`/cookie (U1), `selectLateRisk` (U1).
- Produces: `buildWpSupplyOverlay` (U5 may reuse its plan-line set builder).

- [ ] Gate 1: re-verify load-detail.ts select shape + supply-plan join lines.
- [ ] RED: anchor-coalesce counts store-bound PR toward its WP; open/incoming
      split by band; nextArrival = min eta; null-planned_start WP gets NO late-risk
      flag; both-null PR lands in the project bucket; hasPlan via the
      plans-of-project join.
- [ ] GREEN → suite → SSR-probe: overlay chips render, late-risk row states the
      conflict, no-plan chip opens supply-plan page, project bucket renders. Guards
      green: bottom-tab, nav-back (route untouched), design-doctrine.
- [ ] Fresh-eyes → ship → tracker + site-map `/procurement/[section]` row.

---

## Task U3: เวลา — late-risk list + week radar

**Files:**

- Create: `src/lib/purchasing/time-view.ts` — pure core:
  `selectLateRisk` re-exported/parameterized from U1's late-risk.ts (do NOT
  fork the definition) + `buildWeekRadar(wps, prRows, weekIsoDates)` (arrivals
  this week × WPs starting/running this week; week = `weekOf(bangkokTodayIso())`,
  Sunday-first app convention, calendar-grid.ts:79).
- Create: `src/lib/purchasing/load-time-view.ts` — server loader: WP rows
  (copy the load-detail select, scoped `project_id`), PR rows via
  `PR_LIST_COLUMNS` (columns.ts:6 — already carries eta/needed_by/both anchors).
- Create: `src/components/features/purchasing/time-late-risk-list.tsx` — rows
  state the conflict + link `/requests/{id}` (the exact PR — §0.2; pattern
  overdue-follow-up-panel.tsx:41). List page itself gets NO DetailHeader.
- Create: `src/components/features/purchasing/time-week-radar.tsx` — arrivals ×
  WP-starts grid, `formatThaiDate` (labels.ts:808) everywhere.
- Modify: `src/app/procurement/hub-body.tsx` — section==='time' renders
  `<TimeView view={parsed ?view=}>` above the time door grid. Sub-views are a
  `?view=` param (late | week; default late) parsed like IncomingLens
  (request-bands.ts:143) — a sub-ROUTE would double-light tabs
  (query-blind longest-prefix) and churn the page classifier.
- Modify: `src/app/procurement/dashboard-body.tsx` — alert-strip counts become
  links into `/procurement/time?view=late` and `?view=week` (spec U3 note).
- Modify: `src/lib/i18n/labels.ts` — add `เสี่ยงช้า`, `สัปดาห์นี้`; lift
  `ไทม์ไลน์` here now (schedule-views.tsx:39 + the U3 pill = 2 places; update
  schedule-views to import it).
- Test: `tests/unit/time-view.test.ts`.

**Interfaces:**

- Consumes: U1 selection + late-risk SSOT.
- Produces: `<TimeView>` host with the pill switcher U4 slots `timeline` into;
  `load-time-view.ts` returns `{wps, prRows}` U4 reuses.

- [ ] RED: late-risk list ordering (most-late first — reuse the
      overdue-attention sort idiom, string-compare filter at
      overdue-attention.ts:66); week boundaries via weekOf; a WP running (started
      before, ends within/after week) counts; band exclusions; coalesce assertion
      again at this grain.
- [ ] GREEN → suite → SSR-probe: `?view=` flips pills, late-risk row → PR
      detail, radar renders. Guards green (no new route, no DetailHeader).
- [ ] Fresh-eyes → ship → tracker + site-map.

---

## Task U4: เวลา — visual timeline + shelves

**Why last-of-Time:** the expensive screen, after U3 proves the data. Near-full
math reuse: `gantt-scale.ts` (`buildTimeline` :97, `barFor` :82-94,
`SCHEDULE_PERIODS` :18-22, `THAI_MONTHS` :24-37, BE-years :146 — all exported,
unit-tested). `ScheduleGantt` itself is NOT a drop-in (requires
deliverables/dependencies props, schedule-gantt.tsx:64-65; desktop DNA) — build a
thin procurement component on the same math.

**Files:**

- Create: `src/lib/purchasing/procurement-timeline.ts` — pure projection:
  WP rows → bars (planned window via barFor), PR pins (eta → x via barFor with
  same-start/end window — live precedent activityGeom, schedule-gantt.tsx:251-256),
  pins attach to their anchor-WP row; anchorless (both-null) PRs render on one
  คลัง project lane at top; shelves: `ยังไม่กำหนดวันที่` (undated WPs),
  `ไม่ทราบวันถึง` (active PRs with null eta). Nothing dropped (§0.1).
- Create: `src/components/features/purchasing/procurement-timeline.tsx` —
  `"use client"` thin renderer: flat vertical WP rows (NO deliverable grouping),
  sticky name column, horizontal scroll container whose class carries
  `overflow-x-auto` AND `[touch-action:pan-x_pinch-zoom]` — ⚠ do NOT copy
  ScheduleGantt's `overflow-auto` (:344): it dodges the guard's
  `overflow-x-auto` matcher and fails real-device panning; the guard
  (`ui-class-contracts.test.tsx:96-133`) only protects you if you use the
  x-variant. Zoom pills reuse `SCHEDULE_PERIODS` verbatim. Pins are
  presentational in v1 (no tap targets < 44px). Flatten Maps to plain objects
  before the RSC boundary (schedule page.tsx:36-40 precedent).
- Modify: `src/app/procurement/hub-body.tsx` — `?view=timeline` third pill.
- Modify: `src/lib/i18n/labels.ts` — add `ไม่ทราบวันถึง`; lift
  `ยังไม่กำหนดวันที่` (update schedule-gantt.tsx:580 to import it).
- Test: `tests/unit/procurement-timeline.test.ts` (+ RTL class assertion on the
  scroll container).

**Interfaces:** Consumes U3's `load-time-view` data + TimeView host.

- [ ] RED: pin x equals barFor math; undated WP → shelf not dropped; null-eta →
      shelf; anchorless → คลัง lane; bar geometry for 1-day windows.
- [ ] GREEN → suite (touch-action + RAW_HUE + phantom-token + min-h guards) →
      SSR-probe + DOM class probe for the touch-action pair.
- [ ] Fresh-eyes → ship → tracker + site-map.

---

## Task U5: ทรัพยากร — readiness

**Decisions (resolved here, cite in code comments):**

- Plan scope = **approved supply_plans only** (labeled in the UI; avoids the
  multi-plan draft/rejected double-count).
- กำลังมา = in_transit band (purchased/on_route) INCLUDING WP-bound PRs — the
  store-incoming read (incoming/page.tsx:53-56) filters `work_package_id IS
NULL` and must NOT be copied for coverage. `to_order`/`awaiting_approval` PRs
  count as `ยังไม่สั่งซื้อ` (existing label :570).
- Equipment compares at **project grain**: allocation period + batch
  `ends_on` vs `projects.planned_completion_date` (allocations are
  project-bound; a WP-grain compare has no join). Amber = ends before project
  end; open-ended (`ends_on` null) = no flag.
- Equipment reads via **admin client behind `requireRole(PROCUREMENT_HOME_ROLES)`**
  (zero-grant money tables — RLS-on, zero policies; blueprint
  rentals/page.tsx:57-79). Select `starts_on, ends_on, status` ONLY.
- WPs with zero plan lines render as `ยังไม่มีแผนจัดหา` rows (§0.1 — the U2
  chip semantics at project grain), not hidden.

**Files:**

- Create: `src/lib/purchasing/wp-material-coverage.ts` — pure
  `buildMaterialCoverage(planLines, stockRows, incomingPrRows)` → per-WP (+
  project bucket for null-WP lines) `{plannedQty, inStock, incoming, notOrdered,
notOrderedItems[]}` — the ยังไม่สั่งซื้อ items NAMED (base_item + spec_attrs),
  §0.2. Qty grain: plan qty and stock qty share the item's canonical unit
  (both keyed catalog_item_id) — safe; PR quantity unit is free-text → count
  PR COVERAGE by item presence, not qty arithmetic, and label the approximation
  (§0.5).
- Create: `src/lib/equipment/rental-period-check.ts` — pure
  `flagRentalPeriodGaps(batches, projectEnd)` per the decision above.
- Create: `src/components/features/purchasing/resources-view.tsx` — coverage
  bars (ในคลัง/กำลังมา/ยังไม่สั่งซื้อ split, attn/warn tokens), grain caption
  (สต็อกนับที่ระดับโครงการ — §0.5), equipment rows (amber gap + door to
  `/equipment/rentals`), dashed labor slot (`รอข้อมูลทีมช่าง (เฟสถัดไป)`).
- Modify: `src/app/procurement/hub-body.tsx` — section==='resources' renders
  `<ResourcesView>` above the resources door grid.
- Test: `tests/unit/wp-material-coverage.test.ts`,
  `tests/unit/rental-period-check.test.ts`.

**Interfaces:** Consumes U1 selection; supply-plan reads mirror
supply-plan/page.tsx:104-108 (+194-202 lines select); stock read mirrors
store/page.tsx:102-107 minus `total_value`.

- [ ] Gate 1: re-verify live `pg_policies` for supply_plans/supply_plan_lines/
      stock_on_hand (source-inferred quals — confirm live) + the zero-policy state
      of the two equipment tables.
- [ ] RED: split math (planned = inStock + incoming + notOrdered by item);
      notOrdered items named; approved-plans-only filter; null-WP lines → project
      bucket; zero-plan WP → ยังไม่มีแผนจัดหา row; equipment amber/open-ended/null
      project-end cases; no ฿ field in any selected column list (assert the select
      strings).
- [ ] GREEN → suite → SSR-probe with a real project (plan partly stocked +
      partly incoming): buckets + named missing items + grain caption + labor slot
      render.
- [ ] Fresh-eyes (flag the admin-client read explicitly for review) → ship →
      tracker + site-map.

---

## Task U6: Doors re-home + retire grids + fold spec-326 door

**Decisions:** `[section]/page.tsx` and `parseProcurementSection` SURVIVE (tab
hrefs are frozen — deleting the route 404s three tabs). `PROCUREMENT_STR_SECTIONS`
keeps its 3-section shape (the ทั้งหมด grid renders it grouped — minimal pin
churn). ทั้งหมด = an expandable section on หน้าหลัก (no new route). Copy the
SaTools/Tile pattern (sa-tools.tsx:40-41, local Tile :104) — do NOT extract a
shared primitive in this unit (scope discipline).

**Files:**

- Create: `src/components/features/purchasing/procurement-tools.tsx` — compact
  เครื่องมือ row (most-used doors) + ทั้งหมด expandable full grid (3 labeled
  groups from `PROCUREMENT_STR_SECTIONS`), tiles thread `withBackFrom`. Labels
  stay the SSOT constants — carry-over verbatim.
- Modify: `src/app/procurement/dashboard-body.tsx` — mount `<ProcurementTools>`.
- Modify: `src/app/procurement/hub-body.tsx` — remove the door-grid render
  (sections.map :138-162) + the section-page strip + lens; section pages now
  render ONLY their U2/U3/U5 view. Preserve exports.
- Modify: `src/lib/purchasing/procurement-home.ts` — delete the spec-326
  projects door (:128) — selection subsumes it (D5). `PROJECT_DOOR_HREF` +
  `visibleProcurementDoors` survive (ทั้งหมด grid still needs 📍 resolution).
- Test: `tests/unit/procurement-home.test.ts` — DELETE the spec-326 door pin
  (:124 block); keep/re-point section-membership pins (:116/:148/:199/:245/:277-293
  now assert the ทั้งหมด grid data, same shapes); rewrite strip pins if the
  strip builder retires.
- Modify: `docs/ui-conventions.md` §12 — home-tiles row (:301) adds
  /procurement; rule-8 procurement wording (:341-351) + rule 10; and
  `docs/site-map.md` rows 110-111 rewritten for selection-first.

- [ ] Gate 1: confirm U2/U3/U5 all live on main; grep every door's alternate
      path (rule 4: tiles never the only path — จัดซื้อ family lives in the queue,
      every reference door in ทั้งหมด).
- [ ] RED: procurement-tools renders every section door + the ทั้งหมด grid; the
      projects-door pin deletion seen RED-then-removed deliberately.
- [ ] GREEN → FULL guard sweep (bottom-tab, hub-nav, role-home, nav-back,
      procurement-home, settings-sections stay green; classifier untouched — no
      page.tsx changes) → SSR-probe: every door reachable from หน้าหลัก, section
      pages show pure views, spec-326 door gone but /projects still reachable via
      selection → ขอบเขต → WP rows.
- [ ] Fresh-eyes → ship → tracker + site-map + ui-conventions.

---

## Deferred (explicitly NOT in this plan)

`purchase_order_deliveries.eta` as a second late-risk source · `needed_by`
capture UI · supplier-slippage report · labor readiness · per-WP plan-create ·
queue relocation · SaTools/Tile shared-primitive extraction · portfolio-grain
Resources.

---

## U6 — REVISED at checkpoint 2 (2026-07-18, operator-approved in chat)

Supersedes the original Task U6 above. Two operator findings after U1-U5 went
live: (a) หน้าโครงการ took 5-6 taps though the workspace holds the selection;
(b) users prefer the project-page **icon-chip-row-on-top** idiom (ICON_CHIP,
44px, aria-label) over text door tiles. A consistency audit found 3 icon
clashes that an icon-only row would surface (resolutions below, pinned in
procurement-home.test.ts).

**U6a — icon SSOT + chip rows + project door (code-only):**

- `ProcurementDoor.icon` (required): จัดซื้อ ShoppingCart · โครงการ FolderKanban
  · ทะเบียนวัสดุ Package · เทมเพลตแผนจัดหา FileStack · แผนจัดหา ClipboardList ·
  ใบสั่งซื้อ FileText · ของเข้า Truck · รายงาน BarChart3 · ผู้ขาย Store ·
  ช่างรับเหมา Hammer · อุปกรณ์ Wrench · เช่าอุปกรณ์ Forklift · รายชื่อช่าง
  HardHat · ค่าแรง Wallet · ค่าใช้จ่าย Receipt · ต้นทุนโครงการ PieChart ·
  อัตราค่าแรง Coins. Clash fixes: ขอบเขต TAB icon ShoppingCart→ListChecks;
  settings-hub เช่าอุปกรณ์ Banknote→Forklift.
- `<ProcurementDoorChips>` — icon-only ICON_CHIP row, label = aria-label,
  ?from-threaded, visibleDoors filter; mounted ON TOP of each section page
  (text grid below until U6c) + a quick subset (จัดซื้อ ของเข้า ใบสั่งซื้อ
  ทะเบียนวัสดุ) on the dashboard. Spanning chips deliberately UNSCOPED (the
  U1 invisible-filter trap — the cookie never silently filters the queue).
- `<ProcurementProjectHeader>` — the S/T/R header's project NAME opens
  /projects/[id] (?from back to the tab); dashboard cards gain a FolderKanban
  side-chip to หน้าโครงการ (outside the form — no nested interactive).

**U6b — back fixes (code-only; payroll split into its own danger-held PR):**
the 7 hardcoded-back pages honor ?from via safeBackHref (ordering-templates,
labor-rates, subcontractors, orders list, reports, supply-plan; payroll after
its ?from/?to period-param rename); /requests lights the หน้าหลัก tab for the
procurement tiers (match) so it stops being a strand.

**U6c — retirement (as originally planned, minus the เครื่องมือ text row which
the chip rows replace):** remove section door grids + strip + lens from
section pages; dashboard gains the ทั้งหมด labeled grid (rule 4: every door
keeps a labeled path); delete the spec-326 โครงการ door (selection + the
header door subsume it); retire buildProcurementProjectStatus; docs + pins.
