# Spec 323 — Procurement menu IA on STR (Scope · Time · Resources) + multi-project lens

**Status:** Design approved by operator 2026-07-15 (chat session). Implementation not started.
**Origin:** Operator directive 2026-07-15 (verbatim intent): _"Workflow design should be uniform for procurement users, why is rental even in the setting menus, doesn't even make sense. Procurement user menus need revision, think of basing the menus on STR principles"_ → STR = **Scope, Time, Resources** (the project triple-constraint). Follow-ups: _"there will be more than one project running concurrently"_ (design for concurrency, not one project); on the rental screen — _"skip the P/L for now… just tagging the WPs involved is enough, focus on logging the expenses properly first… forms should [not] be on the same page as list, unless we use modals… workflows are hard to understand for users"_; and on WP-cost attribution — _"remove it entirely in UI, our on-site staffs are not ready for this, check from app usage."_
**Approach:** Refine spec 313's จัดซื้อ domain into an STR sub-structure, pull procurement's active money surfaces out of ตั้งค่า, and make every transactional list project-aware via one reusable lens. Retire the dead WP-cost-attribution UI (verified unused). Ships as a sliced epic; the rental screen is unit 1.

**Relationship to other specs (binding — do not fork):**
- **Supersedes spec 313's procurement per-role nav** (313 = holistic nav-map, approved, only U1 `/team` built). For the **procurement role only**, 323 replaces 313's five-domain tab selection (หน้าหลัก · โครงการ · ทีมงาน · จัดซื้อ · ตั้งค่า) with the STR spine (หน้าหลัก · ขอบเขต · เวลา · ทรัพยากร · ตั้งค่า): it re-buckets every procurement surface across S/T/R and **retires procurement's ทีมงาน `/team` tab** (its คำขอสมัคร queue is re-homed — U3). 313's five-domain model **persists unchanged for all non-procurement roles** (SA / PM / PD / accounting / legal / …); 323 does not touch them. Reference-data-in-settings — nav-law **rule 8**, defined in `docs/ui-conventions.md §12` (spec 93); 313 only _references_ it — is revised **for procurement's active money surfaces** (rental, expenses): those leave procurement's ตั้งค่า for the Resources home, while shared reference doors (vendors, catalog, equipment registry) stay reachable for other roles (U4). This is NOT a global settings-hub restructure (313 §9's non-goal holds for everyone but procurement).
- **Consumes spec 311** deferred units (multi-project readiness): U2 `can_see_wp` gates, U3 mixed-project PO basket guard, U4 rental GL project attribution, U5 payroll reconcile. 323 does not duplicate them — it gives each a home and reuses spec 311 U1's `?project=` chip pattern as the lens.
- **Aligns with spec 321** (profile-edit standardization, active lane): both adopt the operator's 2026-07-15 rule — _detail/home pages read-only, every edit opens a modal/bottom-sheet_. 323 applies the same rule to procurement records (rental deal, settlement). Shared SSOTs (`labels.ts`, nav-back-affordance guard) are touched additively; the nav units serialize with 313/321.

---

## 1. Context and evidence

### 1.1 Procurement's IA today is scattered, not structured

Procurement (`procurement` + `procurement_manager`) lands on `/requests`. Its surfaces are split across **six bottom tabs** and the **ตั้งค่า hub** with no organizing logic — features sit where they were dropped:

- Bottom tabs (`bottom-tab-bar.tsx` `PROCUREMENT_TABS` / `PROCUREMENT_MANAGER_TABS`): จัดซื้อ `/requests` · รายงาน `/requests/reports` · โครงการ `/projects` · ผู้ขาย `/contacts/vendors` · ค่าแรง `/payroll` · ตั้งค่า.
- ตั้งค่า → ข้อมูลหลัก (`settings/sections.ts` `master-data`): อุปกรณ์ registry, **เช่าอุปกรณ์ `/equipment/rentals`**, แคตตาล็อก `/catalog`, ผู้รับเหมาช่วง, แผนสั่งซื้อ.
- ตั้งค่า → ทีมช่าง / ค่าใช้จ่าย / การเงิน: `/workers`, `/payroll`, labor-rates, `/expenses`, accounting.

Rental sits under "master data" beside the equipment _registry_ — but renting is an active, recurring money workflow, not reference data. That mis-file is the symptom; the absence of a principle is the disease.

### 1.2 STR maps procurement's actual lifecycle

A procurement user runs the triple-constraint on every job: a project needs something (**Scope**) → get it there on schedule (**Time**) → commit supply and money (**Resources**). Organizing the menu by S/T/R replaces "where did this land" with "which of the three am I doing."

### 1.3 The WP-cost-attribution machinery is unused — verified live

Live DB probe (2026-07-15, `--linked`):

| metric | value | reading |
| --- | --- | --- |
| `equipment_usage_logs` total | **0** | equipment check-out/check-in to a WP has **never** run |
| distinct WPs ever charged | **0** | no WP was ever charged for equipment |
| `last_checkout_date` | **null** | — |
| `equipment_items` on a rental | **0** | — |
| `rental_charges` rows | **0** | the fee-charge flow has never run |
| active rental batches | **19** | the rental **deals** are live and heavily used |
| current `rental_settlements` | **22** | expense logging is live and heavily used |
| `equipment_project_allocations` | **32** | project binding is live |

So the entire "charged-to-WP" side (`equipment_usage_logs` → `wp_equipment_sell` → the variance card's `คิดเข้างาน` figure) computes over zero rows: the figure is always 0 and the recovery flag is always `ขาดทุน` (under-recovery) — pure noise. The part people use is **record deal → log settlement → bind to project**. The operator's instinct ("remove it in UI, on-site staff not ready, check from app usage") is confirmed by the data.

**Dead WP-attribution UI to retire:** the rental variance card (`rental-variance-list.tsx` on `/equipment/rentals`) and the WP equipment check-out/check-in zone (`wp-equipment-zone.tsx` on the WP detail page, backed by `usage-actions.ts`). Both are hidden/removed from the UI. The underlying tables and RPCs stay dormant (append-only; reversible) — nothing is dropped.

### 1.4 Rental "expense logging" has one concrete hole

A rental settlement stores the invoice **number** (`invoice_no` string) but there is **no attachment surface** — no `rental_settlement_attachments` table, no uploader in `rental-settlement-manager.tsx`. The actual vendor tax-invoice document cannot be stored. (By contrast, spec 310 office-expenses has `office_expense_attachments` + `expense-receipt-uploader.tsx` with สลิป/ใบกำกับภาษี purpose tags.) "Log the expense properly" = give the settlement a receipt.

GL context (unchanged by this spec): a rental posts across four staged events — rent + deposit at batch-create, fees at charge-time, overtime + deposit-release + WHT at settlement (the "thin settlement" rule, ADR 0078). 323 touches presentation and attachments only; it does not re-shape GL posting.

### 1.5 Current rental UX is the anti-pattern the operator named

`rental-manager.tsx` (587 lines) and `rental-settlement-manager.tsx` (501 lines) are large "god" client components that stack **create form directly above list** on one long scroll, with per-row inline expand/collapse sub-forms (allocate, void, correct). No modal/sheet is used, though a shared `BottomSheet` primitive (`@/components/features/common/bottom-sheet`) exists and is used by ~49 screens (including sibling `set-daily-rate.tsx`) and is the exact FAB→sheet pattern spec 310 `/expenses` uses.

---

## 2. Operator decisions (2026-07-15, locked in chat)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Organizing principle | Procurement menus grouped by **STR** = Scope / Time / Resources. |
| D2 | Bucket edges | POs (`/requests/orders`) under **Time** (fulfillment), not Scope. รายงาน stays in **Time**. |
| D3 | Multi-project handling | **Project lens = filter** (default _all projects_, filter to one) — not a global project switcher. Procurement is cross-project by nature. |
| D4 | Tab labels | **Abstract** ขอบเขต / เวลา / ทรัพยากร (principled), over concrete surface names. |
| D5 | Rental P/L | **Drop** the variance card (`ส่วนต่างค่าเช่า`). It is a pure read helper over empty data. |
| D6 | Rental WP link | **No WP tagging.** Retire the WP-cost-attribution UI (variance card + WP check-out zone). On-site staff not ready; usage = 0. |
| D7 | Rental priority | **Expense logging first** — the settlement path done properly, including a receipt/attachment. |
| D8 | Forms | Record forms move **off the list page** into a modal/bottom-sheet (FAB → sheet), matching /expenses and the spec 321 rule. Detail/list stays read-only. |
| D9 | Rental placement | Rental moves out of ตั้งค่า into the **Resources** home. |

---

## 3. The model — two orthogonal axes

Procurement answers two independent questions on every action:

- **What kind of work?** → **STR** (Scope / Time / Resources) — the stable menu spine.
- **Which project?** → a **project lens**, applied _inside_ the structure.

Keeping them orthogonal is what makes the design concurrency-proof: **adding project #3 changes zero menu structure** — it joins the filter and its rows appear. If project were a menu axis, every new project would reshape the nav.

**Surface project-scope classes:**

- 🌐 **shared** — one copy across all projects; no lens (vendors, subcontractors, equipment registry, catalog, ordering templates, labor rates).
- 🔀 **project-spanning** — default shows all projects, filterable to one, each row tags its project when the view spans more than one (requests, POs, incoming, reports, rental, expenses, payroll).

---

## 4. The menu map (approved)

Landing = **Procurement Home** (portfolio hub), with a universal project filter and a per-project status strip, then three STR sections.

| STR bucket | meaning | doors (route · scope-class) |
| --- | --- | --- |
| **① ขอบเขต · Scope** | what's needed / decide to buy | จัดซื้อ `/requests` 🔀 · แคตตาล็อก `/catalog` 🌐 · แผนสั่งซื้อ ordering-templates 🌐 |
| **② เวลา · Time** | when it lands / fulfillment | ใบสั่งซื้อ `/requests/orders` 🔀 · ของเข้า `/incoming` 🔀 · รายงาน `/requests/reports` 🔀 |
| **③ ทรัพยากร · Resources** | supply & money | _supply:_ ผู้ขาย `/contacts/vendors` 🌐 · ผู้รับเหมาช่วง `/contacts/subcontractors` 🌐 · อุปกรณ์ `/equipment` 🌐 · **เช่าอุปกรณ์ `/equipment/rentals` 🔀 (moved from ตั้งค่า)** · รายชื่อช่าง `/workers` 🌐 — _money:_ ค่าแรง `/payroll` 🔀 · ค่าใช้จ่าย `/expenses` 🔀 · ค่ามาตรฐานแรงงาน labor-rates 🌐 (proc-manager + super) |

ตั้งค่า shrinks to real settings: ข้อมูลของฉัน · ความช่วยเหลือ · (ผู้ดูแลระบบ, super only). `/accounting` stays the accounting role's home, outside procurement's map.

**Procurement Home** also carries the **คำขอสมัคร (staff-registration) approval nudge + count** for `STAFF_APPROVAL_ROLES` members (procurement_manager) — re-homed from the retired `/team` tab so the queue keeps a phone path (U3).

**Phone bottom bar** collapses the six scattered tabs to the spine: หน้าหลัก · ขอบเขต · เวลา · ทรัพยากร · ตั้งค่า.

---

## 5. Multi-project mechanics

1. **One universal project filter** (`ทุกโครงการ ▾`), default all — the same control on Home and every 🔀 list. Reuses spec 311 U1's `?project=` chip mechanism (`loadProjectNames` + the site-branch chip row) generalized into a shared component.
2. **🌐 master data has no filter** — shared across all projects; no per-project duplication.
3. **Every 🔀 list tags each row's project** when the view spans more than one (spec 311 U1 rule), so a mixed view is never ambiguous.
4. **Procurement Home shows a per-project status strip** — a compact row per active project (open ขอซื้อ count · arrivals today), tap to scope the hub to one project.
5. **Concurrency gaps get a home:** payroll gains the lens (spec 311 P0), rentals tag project via allocation (spec 311 U4 GL attribution), POs scope to one project (spec 311 U3 mixed-basket guard).

---

## 6. Invariants preserved (binding)

A redesign of presentation and placement — it must not weaken any money invariant:

1. **Money-table zero-grant + admin-read-behind-gate.** Every ฿ field (batch rate, deposit, all settlement amounts, VAT/WHT) stays RLS-on + `revoke all from anon, authenticated`, read only via the admin client behind `requireRole`, written only via SECURITY DEFINER RPCs, every write audited (ADR 0055 d6, ADR 0078). No ฿ field on a field-reachable screen (spec 46).
2. **BACK_OFFICE_ROLES gate** on every rental route/RPC (defense-in-depth over the definer gate). site_admin excluded.
3. **Append-only settlements via supersede** — a correction is a new superseding row, never an UPDATE; current-state reads use the anti-join (CLAUDE.md, ADR 0078 d7).
4. **GL immutability** — corrections are reversal entries; the void path uses `reverse_journal_internal`, never a bare delete (ADR 0057, spec 312). 323 does not change any posting.
5. **Case-A flat transfer price stays retired-but-intact** — dropping the variance card removes only a read view; the usage-log tables/RPCs and `wp_equipment_sell`/`wp_profit` wiring remain (dormant, zero rows). No schema is orphaned.

---

## 7. Units

Sliced so value ships early and the risky nav work is isolated. Units 2/4/5 consume spec 311's parked units rather than duplicating them; unit 3 shares nav SSOTs with spec 313 and **must serialize** on that lane.

### U1 — Rental screen redesign (start here)
The original ask, self-contained, proves the FAB→sheet pattern the rest reuse. Redesigned **in place** (`/equipment/rentals` still reachable from ตั้งค่า until U4 relocates the link) — decoupled from the nav move.
- **Remove** the variance P/L card (`RentalVarianceList` + drop its feed from `page.tsx`; `rental-variance.ts` helper retired). No data touched.
- **Read-only list** of rental deals + their settlements (the dashboard). Split the two god components: list/read presentation vs. sheet-hosted forms.
- **FAB → BottomSheet forms** for: record a rental deal, log a settlement, and the per-row correct/void actions (reuse `@/components/features/common/bottom-sheet`, mirror `add-expense-fab.tsx`). Detail read-only; every edit opens a sheet (spec 321 rule).
- **Receipt uploader** on the settlement — new append-only `rental_settlement_attachments` (สลิป/ใบกำกับภาษี purpose tags), written **the zero-grant money way, NOT the office-expense way**. `rental_settlements` is admin-read-only behind the gate, so the office pattern (an authenticated-INSERT policy joining the parent, which works only because `office_expenses` grants `select` to `authenticated`) would see **zero rows and always deny** — and granting `select` on a ฿-bearing table to fix it would break §6 invariant 1. Instead the metadata row + storage upload go through the **admin client behind `requireRole(BACK_OFFICE_ROLES)`** (or a SECURITY DEFINER RPC), matching the settlements' own posture; the table stays zero-grant with a caller-scoped storage policy. **(schema — additive migration + storage RLS = danger-path, operator-merged.)**
- **Both rental surfaces.** The `RentalManager` split also lands on `src/app/projects/[projectId]/rentals/page.tsx` (spec 275 U5 — the project-locked recorder rendering the same component); bring it into U1, keeping its auto-allocate-to-project behaviour. This reconciles the 2026-07-07 "no rental without a related WP" directive: it now holds at **project-allocation** grain, since the WP-level tie is retired per 2026-07-15 (D6) — rentals attach to a project, not a WP.
- **Tests.** Remove `tests/unit/rental-variance-list.test.tsx` + `tests/unit/rental-variance.test.ts` with the variance card; add RED-first tests for the sheet-hosted forms and the admin-side receipt write.
- Money posture unchanged (§6). TDD RED-first; browser-verify as procurement/back-office.

### U1b — Retire the WP equipment check-out zone
Remove/hide `wp-equipment-zone.tsx` (the check-out/check-in-to-WP surface on WP detail) — the field half of the dead WP-attribution flow the operator rejected. Single importer (the WP detail page); its `equipmentItems/Open/History` loads feed only the zone and it is rate-free (the capture half), so removal is one tab in the WP-detail tab array. Usage = 0; tables/RPCs stay dormant. Small, code-only; isolated from procurement nav. Remove `tests/unit/wp-equipment-zone.test.tsx`.

### U2 — Project-lens component
Extract spec 311 U1's `?project=` chips + `loadProjectNames` into a shared `<ProjectLens>` (chip row + URL-param narrowing + per-row project tag), ready to drop on every 🔀 list. Code-only.

### U3 — STR Home + tabs
The Procurement Home hub (per-project status strip + three STR sections) + collapse the 6 procurement tabs to หน้าหลัก · ขอบเขต · เวลา · ทรัพยากร · ตั้งค่า. **Re-home the คำขอสมัคร (staff-registration) queue** — today it rides procurement_manager's `REGISTRATIONS_TAB` (`bottom-tab-bar.tsx`) and 313 folds it into `/team`; since 323 drops procurement's `/team` tab, surface the queue as a Procurement Home nudge + count for `STAFF_APPROVAL_ROLES` members so it is not orphaned. **Touches `role-home.ts` (procurement landing), `bottom-tab-bar.tsx` (`PROCUREMENT_TABS` / `PROCUREMENT_MANAGER_TABS`), `docs/ui-conventions.md §12`, `docs/site-map.md`, and the nav-back-affordance + tab-set guards — the same SSOTs as spec 313 → SERIALIZE on the nav lane; update guards deliberately, never weaken.** Supersedes spec 313's procurement per-role tab selection (§Relationship).

### U4 — Relocate (procurement-scoped) + apply lens
Surface เช่าอุปกรณ์ (rental), อุปกรณ์, แคตตาล็อก, ผู้ขาย, ผู้รับเหมาช่วง, แผนสั่งซื้อ (ordering-templates) and ค่าใช้จ่าย (expenses) under procurement's STR Resources/Scope homes, and remove them from **procurement's** ตั้งค่า view only. **The settings change is procurement-scoped, not a hub restructure:** other back-office roles (PM/PD) keep their ตั้งค่า doors, and roles whose home is `/expenses` (site_owner/auditor and the rest of `OFFICE_EXPENSE_ROLES`, 313 §4) are untouched. Reference data (vendors/catalog/equipment registry) stays governed by rule 8 for non-procurement roles; the Resources home is procurement's door to it, so 313 §9's "no settings-hub restructure" holds for everyone but procurement. Apply `<ProjectLens>` to incoming, POs, reports, expenses. Update `docs/ui-conventions.md §12` (the procurement exception to rule 8) + the nav-law guard. Mixed risk (`settings/sections.ts` visibility predicates + `labels.ts` additive — coordinate with lane 321).

### U5 — Payroll project lens
Add the project lens to `/payroll` (spec 311 P0: wages are project-blind today). Money/danger-path — operator-merged.

---

## 8. Out of scope / deferred / open questions

- **Non-procurement roles' nav** — 323 restructures the procurement (จัดซื้อ) domain only. PM/PD/super keep spec 313's dashboard-led nav; the STR grouping may later inform their จัดซื้อ view but is not in scope here.
- **The rental proration display bug** (`computeRentalVariance` monthly estimate over-count, memory `rental-monthly-estimate-proration-2026-07`) is **mooted by U1** — the variance card that surfaces it is removed. If any other surface later needs a committed estimate, fix the ÷30 semantics then.
- **GL re-shaping** (input-VAT on the rent leg, settlement base reconciliation, WHT-on-correction) — untouched; separate money spec if the accountant wants it.
- **Global project switcher** — rejected for procurement (D3); may still suit single-project roles (SA, spec 292) but not in this spec.
- **Open — spec framing:** 323 as a standalone spec that amends 313, vs. folding into 313 as its จัดซื้อ-domain revision. Recommended standalone (313 is large and mostly unbuilt; the procurement STR slice is coherent on its own). Operator to confirm on review.
- **Open — U1b scope:** confirm the operator wants the WP equipment check-out zone removed app-wide now, vs. hidden behind a flag pending a future field-ready re-introduction.
