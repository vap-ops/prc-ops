# Navigation-coherence audit — back-threading · tab grammar · form placement (2026-07-17)

> Docs-only audit. **Findings + recommendations, zero behavior changes.** No `src/**`
> was touched. Every recommendation is a proposal for a later, separately-approved unit.
> Method mirrors `docs/procurement-uxui-audit-2026-06.md`: inventory → per-table findings →
> ranked summary. Inbound-link inventory produced by three read-only investigator sweeps
> (projects family / dynamic details / static leaves), cross-checked against the live
> `bottom-tab-bar.tsx`, `hub-nav.tsx`, `role-home.ts`, `settings/sections.ts`,
> `nav-back-affordance.test.ts`, and the `src/lib/nav/*` SSOTs. Judgment calls carry an
> explicit confidence %. Dynamic hrefs not statically attributable are listed UNATTRIBUTED,
> never guessed.

## Baseline cross-check (reconciled)

| Signal                                | Prompt said | Measured                                 | Reconciliation                                                                                                                                                                                                                                      |
| ------------------------------------- | ----------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withBackFrom` occurrences / files    | ~54 / 24    | **54 / 24**                              | exact match                                                                                                                                                                                                                                         |
| `safeBackHref` resolvers              | ~11         | **25 occurrences / 11 files**            | 11 files = **9 detail-page resolvers** + the `back-href.ts` definition (2 refs) + the `contacts/list-path.ts` fallback helper (1 ref). The 9 resolving detail pages are the substantive count; the prompt's "11" counts files. No delta of concern. |
| DetailHeader pages (Table A universe) | —           | **87** page files render `<DetailHeader` | the audit universe                                                                                                                                                                                                                                  |

**Headline:** the referrer-aware standard (`safeBackHref(?from, fallback)` + `withBackFrom`)
is correctly in place on the **7 multi-parent details** in Table A1 (6 of them pinned by the
`nav-back-affordance` guard; `feedback/[id]` resolves `safeBackHref` but is unpinned) — but it was
**never extended to the static settings-leaf pages that spec 323 turned multi-parent**
(vendors, catalog, workers, payroll, expenses, equipment, equipment/rentals). Those keep a
hardcoded `/settings`-or-`/equipment` back chip, so a procurement user who reaches them
through the new `/procurement` STR tiles is bounced OUT of the STR hub on **back**. That is
the dominant coherence gap this audit surfaces. Separately, **`/team` strands the user on
phones** (no lit tab, no back chip), and **threading coverage across inbound links is 11 of
~60 forward links** — the resolvers exist but most links never pass `?from`, so the trail
silently degrades to the hierarchical fallback.

**Totals:** 87 DetailHeader routes inventoried · Table A: 7 COVERED · **11 JUMP-RISK** · ~69
SAFE (single-parent) · Table B: 60 inbound links audited, **11 threaded / 49 unthreaded** ·
Table C: 7 tabbed roles + 8 tabless · **1 HARD strand (`/team`)** · Table D: 52 bottom-sheet
consumers vs 4 pattern-mixing entities.

---

## Table A — multi-parent detail inventory

"Detail page" = any route rendering `DetailHeader`. **Verdict:** SAFE = single arrival
surface (hardcoded back chip is correct) · COVERED = 2+ parents AND resolves `?from` via
`safeBackHref` · JUMP-RISK = 2+ genuinely different parents but hardcoded single fallback (no
`?from`), so **back lands on the wrong parent for ≥1 arrival path**.

### A1 — COVERED (multi-parent, `safeBackHref`-resolved) — 7 details (6 guard-pinned + `feedback/[id]`)

| Route                                                | Entry surfaces (count · list)                                                                                                                                  | Resolves `?from`? | Hardcoded fallback      | Verdict                                                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects/[projectId]`                               | 2 · `/projects` list (N), `dashboard` cards (Y)                                                                                                                | ✅ `safeBackHref` | `/projects`             | **COVERED** — dashboard threaded; list-fallback == list parent                                                                                     |
| `projects/[projectId]/work-packages/[workPackageId]` | 11 · SA home, schedule (gantt+agenda), worklist-row, requests detail, deliverable, camera-fab, action-section, wp-parent-crumb, work-package-list, wp-walk-bar | ✅ `safeBackHref` | `projectHref`           | **COVERED\*** — 8/11 threaded; the 3 unthreaded (wp-parent-crumb, work-package-list, wp-walk-bar) fall back to the project page = a correct parent |
| `requests/[requestId]`                               | 7 · PR card, procurement-grid, po-receive, phone-po-basket, overdue-panel, PO detail, delivery detail                                                          | ✅ `safeBackHref` | `/requests`             | **COVERED\*** — 4 threaded (2 conditional); 3 unthreaded all live on `/requests` (fallback correct)                                                |
| `requests/orders/[poId]`                             | 7 · orders list, procurement-grid, po-group-card, PR detail, accounting/purchases, register, deliveries                                                        | ✅ `safeBackHref` | `/requests`             | **COVERED\*** — 3 threaded; PR-detail→PO link (`requests/[requestId]:409`, N) jumps to `/requests` not the PR (Table B)                            |
| `legal/contracts/[contractId]`                       | 2 · contracts list (Y), approvals list (Y)                                                                                                                     | ✅ `safeBackHref` | `/legal/contracts`      | **COVERED** — both parents threaded                                                                                                                |
| `contacts/[type]/[id]`                               | 4 · clients/suppliers/contractors/service-providers tabs (all Y)                                                                                               | ✅ `safeBackHref` | `contactListPath(type)` | **COVERED** — all four threaded                                                                                                                    |
| `feedback/[id]`                                      | 2 · my-feedback-list (Y), review kanban (Y)                                                                                                                    | ✅ `safeBackHref` | `/feedback`             | **COVERED** — both threaded                                                                                                                        |

`COVERED*` = resolver present and design intent met, but ≥1 inbound link does not pass
`?from`; back then uses the hierarchical fallback, which for these happens to be a correct
parent. The unthreaded links are logged in Table B.

### A2 — JUMP-RISK (multi-parent, hardcoded fallback wrong for ≥1 parent)

These render `DetailHeader` with a **hardcoded** `backHref` yet are reachable from 2+
genuinely different parents. None thread `?from`. The spec-323 `/procurement` STR tiles are
the new second parent on rows 1–7. Confidence that each is genuinely multi-parent: **95%**
(from static call-site inventory; the "wrong-for-a-parent" judgment is design opinion, ~85%).

| Route               | Entry surfaces (count · list)                                                     | Resolves `?from`?                               | Hardcoded fallback | Why JUMP-RISK                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `workers`           | 5 · `/team`, labor-log-zone (WP), settings hub, `/procurement` tile, PM hub-strip | ❌                                              | `/settings`        | from `/team` or a WP labor zone or `/procurement`, back → `/settings` (never where you were). Highest-traffic (SA + PM + procurement) |
| `payroll`           | 3 · `/team`, settings hub, `/procurement` tile                                    | ❌                                              | `/settings`        | money surface; from `/team` or `/procurement`, back → `/settings`                                                                     |
| `expenses`          | 2 · settings hub, `/procurement` tile                                             | ❌                                              | `/settings`        | from `/procurement` Resources, back → `/settings` (procurement's ตั้งค่า doesn't even list it)                                        |
| `equipment/rentals` | 3 · settings hub, `/equipment`, `/procurement` tile                               | ❌                                              | `/equipment`       | from `/procurement` Resources, back → `/equipment` not `/procurement`                                                                 |
| `equipment`         | 2 · settings hub (2 rows), `/procurement` tile                                    | ❌                                              | `/settings`        | from `/procurement`, back → `/settings`                                                                                               |
| `catalog`           | 3 · catalog-item-picker (PR flow), settings hub, `/procurement` tile              | ❌                                              | `/settings`        | from the PR item-picker or `/procurement`, back → `/settings`                                                                         |
| `contacts/vendors`  | 2 · settings hub, `/procurement` tile                                             | ⚠️ ad-hoc (`isManager ? /settings : /requests`) | computed           | procurement (non-manager) backs to `/requests`; arrived from `/procurement` tile → still not `/procurement`. Partial                  |
| `sa/registrations`  | 2 · `/team`, `/sa`                                                                | ❌                                              | `/sa`              | from `/team`, back → `/sa` (wrong)                                                                                                    |
| `sa/plan`           | 3 · project page, sa-tools tile, daily-plan-board                                 | ❌                                              | `/sa`              | from a project page, back → `/sa` not the project                                                                                     |
| `profile`           | 3 · app-header avatar (global), coming-soon tile, settings                        | ❌                                              | `/settings`        | avatar is a global entry from any screen; back always → `/settings`                                                                   |
| `nova/dials`        | 2 · `/workers`, `/nova`                                                           | ❌                                              | `/nova`            | from `/workers`, back → `/nova` (wrong)                                                                                               |

Recorded as **not** JUMP-RISK (single fallback is adequate or handled): `accounting/ledger`
computes its own referrer-aware back (`supplierId → /accounting/payables`, else
`/accounting?…`) — an ad-hoc but functional referrer trail; `contacts/subcontractors` and
`contacts/customers` are settings-hub-primary (subcontractors also a `/procurement` tile —
borderline, ~60% JUMP-RISK, listed here for completeness not counted).

### A3 — SAFE (single-parent details) — ~70 routes, grouped by hierarchical parent

Each is reached from exactly one list/hub; the hardcoded back chip is correct. Verified
single-inbound in the investigator sweep (confidence 90% — a rarely-linked second path can
hide behind a computed prop, but none surfaced).

| Hierarchical parent (back target)              | SAFE detail routes (representative; count)                                                                                                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/accounting`                                  | wht, payables, retention, journal, billings, periods, purchases, projects, purchases/[id], projects/[projectId] (10)                                                                                                                                                        |
| `/settings` + `/settings/*`                    | roles, roles/[id], roles/capabilities, org-chart, view-as, usage, usage/[actorId], friction-map, ordering-templates, ordering-templates/[templateId], wp-grouping-import, integrity, my-info, cards, labor-rates, notifications, payout-nominees, payout-nominees/edit (18) |
| `/nova`                                        | dials\*, settlement, shop, worker/[id] (\*dials is A2)                                                                                                                                                                                                                      |
| `/catalog`                                     | subcategories, boq-templates, boq-templates/[templateId] (3)                                                                                                                                                                                                                |
| `/legal`                                       | contracts, approvals (2)                                                                                                                                                                                                                                                    |
| `/registrations`, `/sa`                        | registrations/[id], registrations/awaiting-bank, sa/registrations/[id], sa/help (4)                                                                                                                                                                                         |
| `projects/[id]/*` (project cockpit)            | settings, reports, schedule, supply-plan, store, store/items/[ciId], incoming, incoming/[deliveryId], muster, rentals, deliverables/[dId] (11)                                                                                                                              |
| `/requests`, `/requests/orders/[poId]`         | reports, reports/register, orders, orders/[poId]/deliveries/[deliveryId] (4)                                                                                                                                                                                                |
| `/review`, `/dashboard`, `/team`, `/equipment` | review/work-packages/[wpId], contacts/bank-changes, team/badges, equipment/rentals\* (\*rentals is A2)                                                                                                                                                                      |

> **Structural note:** the `nav-back-affordance.test.ts` `MULTI_PARENT_DETAILS` guard pins 6
> of the 7 A1 routes (it omits `feedback/[id]`, which resolves `safeBackHref` regardless). It
> has **no coverage of the A2 static multi-parent pages** — those
> render `DetailHeader` and pass the "drill-down renders DetailHeader" assertion, but nothing
> checks that their back chip is referrer-aware. Spec 323 widened their parent set without a
> guard to catch the resulting hardcoded-back regression. (Recommendation R1.)

### A — UNATTRIBUTED

`src/app/settings/wp-grouping-import/actions.ts:82` — `revalidatePath('/projects/${projectId}/work-packages')`
is a WP **list** path, not a detail route (revalidate, not a nav link). No inbound _navigation_
href was left unattributable. **UNATTRIBUTED nav links: none.**

---

## Table B — unthreaded inbound links into COVERED / JUMP-RISK routes

Every rendered link INTO an A1 (COVERED) or A2 (JUMP-RISK) route, and whether it passes
`withBackFrom`. A `withBackFrom N` into a multi-parent detail is where the referrer trail
silently breaks (back falls to the hierarchical fallback instead of returning to the caller).
`Y*` = conditional (threaded only when a `backFrom`/scope prop is supplied).

### B1 — into COVERED routes (A1)

| file:line                                                                                                                                             | target route                                                      | withBackFrom                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `components/features/purchasing/purchase-request-card.tsx:80,83`                                                                                      | requests/[requestId]                                              | **Y\***                                                                                                         |
| `components/features/purchasing/po-receive-section.tsx:107`                                                                                           | requests/[requestId]                                              | **Y\***                                                                                                         |
| `components/features/purchasing/procurement-grid.tsx:809`                                                                                             | requests/[requestId]                                              | **N**                                                                                                           |
| `components/features/purchasing/phone-po-basket.tsx:103`                                                                                              | requests/[requestId]                                              | **N**                                                                                                           |
| `components/features/purchasing/overdue-follow-up-panel.tsx:41`                                                                                       | requests/[requestId]                                              | **N**                                                                                                           |
| `app/requests/orders/[poId]/page.tsx:251`                                                                                                             | requests/[requestId]                                              | **Y**                                                                                                           |
| `app/requests/orders/[poId]/deliveries/[deliveryId]/page.tsx:178`                                                                                     | requests/[requestId]                                              | **Y**                                                                                                           |
| `components/features/purchasing/procurement-grid.tsx:555`                                                                                             | requests/orders/[poId]                                            | **N**                                                                                                           |
| `components/features/purchasing/po-group-card.tsx:36`                                                                                                 | requests/orders/[poId]                                            | **N**                                                                                                           |
| `app/requests/[requestId]/page.tsx:409`                                                                                                               | requests/orders/[poId]                                            | **N** — PR→parent-PO link; back jumps to `/requests` not the PR (procurement audit pr-lifecycle-09, still open) |
| `app/requests/orders/[poId]/deliveries/[deliveryId]/page.tsx:115`                                                                                     | requests/orders/[poId]                                            | **N** (via `poDetailHref`, DetailHeader back)                                                                   |
| `app/requests/orders/page.tsx:148` · `accounting/purchases/[id]:54` · `requests/reports/register:101`                                                 | requests/orders/[poId]                                            | **Y** ×3                                                                                                        |
| `components/features/work-packages/wp-parent-crumb.tsx:27`                                                                                            | WP detail                                                         | **N**                                                                                                           |
| `app/projects/[projectId]/work-package-list.tsx:337`                                                                                                  | WP detail                                                         | **N**                                                                                                           |
| `components/features/work-packages/wp-walk-bar.tsx:41,59`                                                                                             | WP detail                                                         | **N** (manual `?from=`, not the helper)                                                                         |
| (WP detail threaded parents) worklist-row, schedule-gantt, schedule-agenda, sa/page ×4, action-section, camera-fab, requests/[requestId], deliverable | WP detail                                                         | **Y** (8)                                                                                                       |
| `app/projects/page.tsx:144`                                                                                                                           | projects/[projectId]                                              | **N** (fallback `/projects` = correct parent)                                                                   |
| `app/dashboard/page.tsx:278`                                                                                                                          | projects/[projectId]                                              | **Y**                                                                                                           |
| contacts-tabs ×4, legal contracts/approvals ×2, feedback list/kanban ×2                                                                               | contacts/[type]/[id], legal/contracts/[contractId], feedback/[id] | **Y** (8)                                                                                                       |

### B2 — into JUMP-RISK routes (A2) — all unthreaded

Every forward link into an A2 page is `withBackFrom N`. These are the links that, once the
back chip is made referrer-aware (R1), would need `?from` to make back return correctly.

| file:line                                                                                                     | target route      | withBackFrom |
| ------------------------------------------------------------------------------------------------------------- | ----------------- | ------------ |
| `app/team/page.tsx:362` · labor-log-zone.tsx:350 · sections.ts:218 · procurement-home.ts:128 · hub-nav.tsx:45 | workers           | **N** ×5     |
| `app/team/page.tsx:369` · sections.ts:225 · procurement-home.ts:129                                           | payroll           | **N** ×3     |
| `procurement-home.ts:130` · sections.ts:288                                                                   | expenses          | **N** ×2     |
| `procurement-home.ts:127` · equipment/page.tsx:80 · sections.ts:183                                           | equipment/rentals | **N** ×3     |
| `sections.ts:129,174` · procurement-home.ts:126                                                               | equipment         | **N** ×3     |
| `catalog-item-picker.tsx:342` · sections.ts:191 · procurement-home.ts:97                                      | catalog           | **N** ×3     |
| `sections.ts:158` · procurement-home.ts:119                                                                   | contacts/vendors  | **N** ×2     |
| `app/team/page.tsx:332` · sa/page.tsx:247                                                                     | sa/registrations  | **N** ×2     |
| `projects/[projectId]/page.tsx:304` · sa-tools.tsx:73 · daily-plan-board.tsx:156                              | sa/plan           | **N** ×3     |
| `app-header.tsx:50` · coming-soon/page.tsx:157 · settings/page.tsx:95                                         | profile           | **N** ×3     |
| `workers/page.tsx:95` · nova/page.tsx:105                                                                     | nova/dials        | **N** ×2     |

**Threading scorecard:** ~60 forward inbound links audited across A1+A2 → **11 threaded**
(all into WP detail / PO chain / contacts / legal / feedback / dashboard→project) · **49
unthreaded**. The referrer standard is real but under-adopted: the entire settings-leaf and
STR-tile surface passes no `?from` at all.

### B — UNATTRIBUTED

None. Every inbound link statically attributes to a target
(`registration-queue-list.tsx:47` resolves via its two callers' `detailHrefFor` props;
computed helpers `ledgerHref`, `reportHref`, `registerDrillHref`, `planHref`, the contact
redirect-map — all attributed).

---

## Table C — tab grammar per role

**Grammar:** _destination-bar_ = tabs name places you go (โครงการ / จัดซื้อ / …) ·
_section-spine_ = tabs name abstract phases of one domain (ขอบเขต / เวลา / ทรัพยากร — spec
323's STR). **HARD flag** = a page that lights **no tab AND shows no back chip** for a role
that can reach it.

| Role                                             | Tab set (code SSOT)     | Count | Home tab · position                                  | Grammar                                       | Unlit-leaf pages reachable (render DetailHeader back chip unless noted)                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------- | ----- | ---------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| site_admin                                       | `SA_TABS`               | 4     | `/sa` · **1st**                                      | destination-bar                               | WP detail (no tab; amber capture bar owns thumb zone, by spec), `/sa/plan`, `/sa/help`, `/sa/registrations`, project sub-routes, **`/team` ⚠ (no back chip — HARD)**                                                                                                                                                       |
| project_manager · super_admin · project_director | `PM_TABS`               | 5     | `/dashboard` · **3rd**                               | destination-bar                               | `/review` (lit via `match`), `/workers`, `/payroll`, `/accounting`, `/catalog`, `/contacts/*`, `/equipment`, settings children, **`/team` ⚠ HARD**                                                                                                                                                                         |
| procurement · procurement_manager                | `PROCUREMENT_STR_SPINE` | 5     | `/procurement` · **1st**                             | **section-spine** (only one in app)           | `/requests`, `/requests/orders`, `/requests/reports`, `/incoming`, and every STR door (`/catalog`, `/workers`, `/payroll`, `/expenses`, `/equipment`, `/equipment/rentals`, `/contacts/vendors`) — all render a back chip, but it points to `/settings`/`/equipment` not `/procurement` (A2 JUMP-RISK). **`/team` ⚠ HARD** |
| project_coordinator                              | `COORDINATOR_TABS`      | 2     | `/projects` · **1st**                                | destination-bar                               | project sub-routes (back chip)                                                                                                                                                                                                                                                                                             |
| accounting                                       | `ACCOUNTING_TABS`       | 2     | `/accounting` · **1st**                              | destination-bar                               | `/accounting/*` children, `/requests/orders/[poId]` (view), `/requests/reports`, `/payroll` (view). ⚠ `/accounting` home renders `DetailHeader` back → `/settings` (home-points-up, see note)                                                                                                                              |
| legal                                            | `LEGAL_TABS`            | 2     | `/legal` · **1st**                                   | destination-bar                               | `/legal/contracts`, `/legal/approvals`. ⚠ `/legal` home back → `/settings` (home-points-up)                                                                                                                                                                                                                                |
| technician · contractor · client · visitor       | `tabsForRole → null`    | 0     | own home (`/technician` · `/portal` · `/client` · —) | — (by design: bespoke header / external tier) | own home has neither tab bar nor back chip — acceptable (it IS home)                                                                                                                                                                                                                                                       |
| site_owner · auditor · hr · subcon_manager       | `null`                  | 0     | `/coming-soon`                                       | —                                             | site_owner/auditor can reach `/expenses` (OFFICE_EXPENSE_ROLES) with no tab bar; edge — no built home yet                                                                                                                                                                                                                  |

**HARD strand — `/team` (confidence 90%):** `TEAM_PAGE_ROLES` = SITE_STAFF + procurement +
procurement_manager can all open `/team`, it is classified `NON_DETAIL` (no back chip, spec
313 U1 hub), yet **no role's `*_TABS` set contains `/team`** and no `*_HUB_NAV` strip lists
it. On desktop the HubNav strip renders (you can leave via another strip item) but on **phone
the bottom bar lights nothing and there is no back chip → the user is stranded** and must use
the browser/PWA gesture. `/team` is reached only via the `sa-tools` tile and cross-links, so
this bites whoever drills in from those. This is the one HARD flag.

**Home-points-up anomaly (soft):** `/accounting` and `/legal` are role _homes_ (roleHome) yet
render `DetailHeader` with `backHref="/settings"`. Tapping back from your own home lands on
settings — harmless (both are also `NON_DETAIL`-adjacent lean-tab homes) but grammatically odd:
a home should not offer an "up" chip. Recorded, not counted as HARD.

**Home-not-first (soft):** PM tier's home `/dashboard` sits 3rd in `PM_TABS` (โครงการ · จัดซื้อ
· **ภาพรวม** · คำขอสมัคร · ตั้งค่า). Every other tabbed role's home is 1st. Deliberate (spec 183
put ภาพรวม where the pending-approval badge reads best), noted for the doctrine discussion.

---

## Table D — form placement

**Patterns:** _bottom sheet_ (`@/components/features/common/bottom-sheet`, 52 consumers — the
overwhelming default) · _dedicated page_ (its own route) · _inline-on-detail_ (rendered in the
page body) · _pinned-form_ (spec 10 pinned mode on a list).

| Entity / action                                                                                     | Pattern                                                                  | Notes                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Rental deal · settlement · correct · void                                                           | bottom sheet                                                             | spec 323 U1c migrated these off inline-on-list → FAB→sheet                                                  |
| Office expense                                                                                      | bottom sheet (`add-expense-fab`)                                         | the reference FAB→sheet                                                                                     |
| Catalog item / category / subcategory / sell-rate                                                   | bottom sheet                                                             | add + edit both                                                                                             |
| BOQ template                                                                                        | bottom sheet                                                             |                                                                                                             |
| Project: new / add-WP / import-WP / group-WP / copy-WP / add·edit·import deliverable / add-category | bottom sheet                                                             | 10 sheets on the project cockpit                                                                            |
| Store: issue-stock · count · receipt-correction                                                     | bottom sheet                                                             |                                                                                                             |
| Labor: record-payment · budget · daily-rate                                                         | bottom sheet                                                             |                                                                                                             |
| Accounting: revenue · billing · WHT                                                                 | bottom sheet                                                             |                                                                                                             |
| Profile: bank · contact · display-name · identity-change                                            | bottom sheet                                                             | spec 321 rule — detail read-only, edit in sheet                                                             |
| WP: report-defect · submit-for-approval · assignment                                                | bottom sheet                                                             |                                                                                                             |
| SA: add-technician · report-issue · camera · project-switcher · role-picker                         | bottom sheet                                                             |                                                                                                             |
| Purchasing: create-PO · catalog-item-picker · split-delivery · record                               | bottom sheet                                                             |                                                                                                             |
| **Purchase request (raise)**                                                                        | **pinned-form** on `/requests` (spec 10/12)                              | ⚠ mixes with PO creation's sheet — two procurement create-flows, two patterns                               |
| **Payout-nominee (edit)**                                                                           | **dedicated page** `/settings/payout-nominees/edit` → `router.push` back | ⚠ the lone dedicated-page CRUD in a sheet-dominant app                                                      |
| **Feedback (submit)**                                                                               | **page-embedded form** `/feedback`                                       | ⚠ mixes with the app-wide `report-issue-fab` → sheet — two ways to file, two patterns                       |
| **Project settings (meta)**                                                                         | **page form** `settings-form.tsx` (hosts sub-action sheets)              | mixed _within one screen_ — page for meta, sheets for deliverable/WP actions (different grains, acceptable) |
| WP capture: phase-uploader · labor-log-zone                                                         | inline-on-detail                                                         | field capture, inline by design                                                                             |
| Onboarding: register/technician · register/office · portal/claim · client/claim · contract-create   | dedicated page / push                                                    | pre-role or first-create; by design                                                                         |

**Pattern-mixing entities flagged (4):** purchase-request (pinned vs PO-sheet), payout-nominee
(dedicated page vs sheet norm), feedback (page-form vs report-issue-sheet), project-settings
(page vs sheet within one screen). The first three are cross-screen inconsistencies; the last
is an intra-screen grain split.

**Orphan / near-orphan pages (found during the sweep, recorded — not in audit scope to fix):**
`/settings/wp-grouping-import` (no forward inbound link in `src/**`; only a child link to its
own `/template`), `/catalog/boq-templates` (only a child link + a back chip; no hub/menu row),
`/settings/payout-nominees` list (reachable only via post-save `router.push` from its own edit
form — no settings-hub row). Confidence 85% (a computed/prop href could hide a path).

---

## Summary

### Counts

- **87** DetailHeader routes · **7 COVERED** · **11 JUMP-RISK** · **~69 SAFE**.
- Back-threading: **11 of ~60** forward inbound links pass `?from`; **49 unthreaded**.
  Resolvers: **9 detail pages** (+ 2 helper files).
- Tab grammar: **7 tabbed roles** (6 destination-bar, 1 section-spine) + **8 tabless**;
  **1 HARD strand (`/team`)**; 2 home-points-up anomalies; 1 home-not-first (PM).
- Form placement: **52 bottom-sheet consumers**; **4 pattern-mixing entities**; 3 orphans.

### Top-10 back-jump candidates (ranked by role-criticality — SA capture + PM approval first)

1. **`/workers` back → `/settings`** (A2). SA reaches it from `/team` and from a WP labor
   zone mid-capture; back throws them to settings, off the capture flow. Highest daily traffic.
2. **`/team` phone strand** (Table C HARD). SA/PM/procurement drill in from the `sa-tools`
   tile; on phone there is no lit tab and no back chip — dead end. Blocks the SA people loop.
3. **`/payroll` back → `/settings`** (A2). PM/procurement approval-adjacent money surface
   reached from `/team` and `/procurement`; back leaves the wage context.
4. **`requests/[requestId]` ← procurement-grid / phone-po-basket / overdue-panel unthreaded**
   (Table B1). The PM/procurement approval worklist; back to `/requests` is correct only
   because those callers live there — but the trail is invisible, fragile to a route move.
5. **`requests/orders/[poId]` ← PR-detail parent-PO link unthreaded** (B1,
   `requests/[requestId]:409`). Arrive at a PO from its PR line, back jumps to `/requests`,
   not the PR. The still-open procurement-audit `pr-lifecycle-09`.
6. **`/expenses` back → `/settings`** (A2). Procurement Resources door; back exits the STR hub
   into a settings section that no longer even lists expenses for that tier.
7. **`/equipment/rentals` back → `/equipment`** (A2). The spec-323 flagship (rental moved into
   Resources); back lands on the equipment registry, not the `/procurement` hub it opened from.
8. **`/catalog` back → `/settings`** (A2). Reached mid-PR from the catalog-item-picker and from
   `/procurement`; back drops the buyer out of the purchasing flow.
9. **`/sa/registrations` back → `/sa`** (A2). Reached from `/team`; back to `/sa` not `/team`
   — breaks the SA/approver crew loop.
10. **`/profile` back → `/settings`** (A2). The app-header avatar is a global entry from any
    screen; back always dumps you in settings regardless of origin.

### Recommendations (proposals only — each a separately-approved unit)

**(a) Required `from` param on multi-parent href helpers.** The referrer standard works; the
gap is adoption. Proposal: for routes that spec 323 (and future work) make multi-parent, make
threading structural rather than optional —

- Extend `nav-back-affordance.test.ts`'s `MULTI_PARENT_DETAILS` guard to include the A2
  pages (or a new `STATIC_MULTI_PARENT` list) so a hardcoded back chip on a 2+-parent page
  fails CI, the same way the 6 currently-pinned dynamic details are (and closing the
  `feedback/[id]` gap where a COVERED route is unpinned). **This guard extension is the
  highest-leverage single change** — it converts the whole A2 class from silent to caught.
- Give the STR-tile and settings-leaf pages a `safeBackHref(?from, currentFallback)` back
  chip, and have `procurement-home.ts` / `sections.ts` / `sa-tools` / `/team` links pass
  `withBackFrom(...)`. Consider a typed helper whose signature _requires_ a `from` argument
  for the known multi-parent targets (a builder that won't compile without it), so a new
  call site cannot forget to thread — the compile-time version of the guard.
- `contacts/vendors`' ad-hoc `isManager ? … : …` and `accounting/ledger`'s query-param back
  are evidence the need is already felt; fold them onto the one `safeBackHref` standard.

**(b) Tab-grammar doctrine — including the procurement-spine question.** The app now runs
**two grammars at once**: destination-bar (every role) and section-spine (procurement's STR).
Options for the doctrine to settle:

- _Keep the split_ (status quo): procurement is genuinely a single-domain workflow, so a
  phase-spine fits it; document that section-spine is a sanctioned second grammar reserved
  for single-domain roles, and require any new spine to justify it. **Recommended (75%)** —
  STR shipped and tested well; the cost is the A2 back-jumps, which (a) fixes without
  touching the grammar.
- _Converge on destination-bar_: give procurement a destinations bar (จัดซื้อ / โครงการ /
  …) and demote STR to an in-hub section layout. Cleaner one-grammar story; discards
  spec-323's approved model. Not recommended without operator appetite to re-open 323.
- Resolve `/team`'s HARD strand independently of the grammar choice: either add it to the
  SA/PM tab-or-strip sets, or give the hub a back chip (it is a drill-in from a tile, so a
  back chip is defensible despite its `NON_DETAIL` classification).
- Consider moving the PM home `/dashboard` to tab position 1 for cross-role consistency, or
  document the deliberate exception.

**(c) Form-placement doctrine (one line).** Adopt: **"Every create/edit opens a bottom sheet
(`common/bottom-sheet`); a dedicated page or inline form requires a recorded reason
(onboarding workspace, field capture, or spec-10 pinned mode)."** That codifies the existing
52-sheet norm and turns the 4 mixing entities (purchase-request, payout-nominee, feedback,
project-settings) into explicit, justified exceptions rather than drift.

---

_Scope-out (recorded, not done): no `src/**` change, no new helper, no doctrine test, no
`ui-conventions.md` edit, no spec authoring, no link fix. This document + one tracker line are
the only artifacts._
