# Spec 323 — Procurement STR IA — Implementation Plan

> **For agentic workers:** each unit is one `ship-unit` PR (the repo's gated loop: lane claim → dependency gate-check against LIVE form → TDD RED-first → real-browser verify → fresh-eyes review → `scripts/ship-pr.sh`). Steps use `- [ ]` for tracking. Build in phase order; Phase 3 (nav) SERIALIZES with spec 313.

**Goal:** Restructure procurement's navigation on STR (Scope/Time/Resources) with a universal project lens for concurrent projects, and redesign the rental screen into a sheet-based expense logger.

**Architecture:** Ship as small PRs. Phase 1 rebuilds the rental screen in place (no nav move yet) — the lowest-risk, highest-value slice that also proves the FAB→BottomSheet pattern the later phases reuse. Phases 2–5 build the lens component, the STR home/tabs (nav SSOTs — serialized), the procurement-scoped relocation, and the payroll lens.

**Tech Stack:** Next.js 16 App Router (Server Components default), Supabase (Postgres + RLS + Storage), `@/components/features/common/bottom-sheet`, Vitest + Playwright + pgTAP, Field-First token system.

## Global Constraints (copied from spec §6 — every task inherits these)

- **Money zero-grant.** Every ฿ field stays RLS-on + `revoke all from anon, authenticated`; read only via the admin client behind `requireRole`; written only via SECURITY DEFINER RPC **or** the admin client behind the role gate; every write audited. Never render a ฿ field on a site_admin-reachable screen. Never `grant select` on a ฿-bearing table.
- **BACK_OFFICE_ROLES gate** on every rental route/action (defense-in-depth over the definer gate). site_admin excluded.
- **Append-only supersede** for settlements — new superseding row, never UPDATE; current-state reads use the anti-join.
- **GL immutability** — no posting changes in this spec; corrections are reversal entries; void via `reverse_journal_internal`.
- **Case-A intact** — the usage-log tables/RPCs + `wp_equipment_sell`/`wp_profit` stay in place (dormant); this spec removes only their UI.
- **Edit = modal/sheet** (operator rule 2026-07-15, shared with spec 321) — detail/list pages read-only; every create/edit opens a sheet.
- **TDD RED-first** (CLAUDE.md); Thai strings via Edit/Write (never PowerShell); ship via `scripts/ship-pr.sh`; delete merged branches.
- **Nav SSOTs** (`role-home.ts`, `bottom-tab-bar.tsx`, nav guards, `labels.ts`, `ui-conventions.md §12`, `site-map.md`) move deliberately and SERIALIZE with lane 313 / lane 321 — never weaken a guard.

---

## Phase / unit sequence

| Phase | Unit (PR) | Risk | Depends on | Serializes with |
| --- | --- | --- | --- | --- |
| 1 | **U1a** drop dead P/L variance card | code-only | — | — |
| 1 | **U1b** retire WP equipment check-out zone | code-only | — | — |
| 1 | **U1c** rental forms → FAB + bottom-sheet (both rental pages) | code-only | U1a | — |
| 1 | **U1d** settlement receipt attachment | **schema/danger** (operator-merge) | U1c | schema lane |
| 2 | **U2** shared `<ProjectLens>` component | code-only | — | — |
| 3 | **U3** STR Home + procurement tabs | **danger** (nav SSOTs) | U2 | **spec 313**, spec 321 |
| 4 | **U4** procurement-scoped relocate + apply lens | mixed | U2, U3 | spec 321 |
| 5 | **U5** `/payroll` project lens | **danger** (money) | U2 | — |

Build Phase 1 now. Phases 2–5 are outlined below and detailed at build time (each depends on the then-current LIVE nav state, which lane 313 is concurrently changing).

---

# PHASE 1 — Rental screen redesign

## Task U1a: Drop the dead P/L variance card

**Why:** `equipment_usage_logs` = 0 live rows → the variance card's `คิดเข้างาน` is always 0 and the flag always `ขาดทุน`. Pure noise; removing it is safe (no schema, no other prod consumer — verified: `computeRentalVariance`/`RentalVarianceList` imported only by `/equipment/rentals/page.tsx`).

**Files:**
- Delete: `src/components/features/equipment/rental-variance-list.tsx`
- Delete: `src/lib/equipment/rental-variance.ts`
- Delete: `tests/unit/rental-variance-list.test.tsx`, `tests/unit/rental-variance.test.ts`
- Modify: `src/app/equipment/rentals/page.tsx` — remove the `RentalVarianceList` import + render (lines ~18-21, ~232-234) and the variance compute block (imports of `computeRentalVariance`/`RentalVarianceSettlementRow`/`RentalVarianceUsageRow` ~32-36, the `usageRows`/`usageByBatch`/`settlementsByAgreement`/`agreementVariances` blocks ~83-209, and the now-unused `equipment_items`/`equipment_usage_logs` admin reads ~78-96).
- Modify: `src/lib/i18n/labels.ts` — remove the `RENTAL_VARIANCE_*` labels (lines ~449-464) if no other importer remains (grep first).

**Interfaces:**
- Produces: `/equipment/rentals` page renders `RentalManager` + `RentalSettlementManager` only (no third card). No new exports.

- [ ] **Step 1 — Gate-check (dependency):** grep confirms no other importer.

Run: `rg -n "rental-variance|RentalVarianceList|computeRentalVariance|RENTAL_VARIANCE_" src` — expect matches only in the files above.

- [ ] **Step 2 — RED:** the page test asserting the variance card is gone.

In `tests/unit/` (page-level test, or a new `tests/unit/equipment-rentals-page.test.tsx` if none exists), assert the rendered page does NOT contain `RENTAL_VARIANCE_LABEL` text. Run it → expect FAIL (card still present) before deletion. (If a page test does not exist, the RED is the two variance unit tests currently PASSING — deleting the modules makes them the thing under change; write one new page-level assertion for the negative.)

- [ ] **Step 3 — Implement:** delete the two component/lib files + their tests; strip the page's variance imports/compute/render + the now-dead usage reads.

- [ ] **Step 4 — GREEN + guards:**

Run: `pnpm typecheck && pnpm lint && pnpm test` — expect green (no dangling imports; the removed `equipment_items`/`usage_logs` reads leave no unused vars).

- [ ] **Step 5 — Real-flow verify:** dev-preview login as a BACK_OFFICE role, load `/equipment/rentals`, confirm the ส่วนต่างค่าเช่า card is gone and the deal + settlement sections render, zero console errors.

- [ ] **Step 6 — Fresh-eyes + ship:** reviewer subagent on the diff; then `scripts/ship-pr.sh`. Code-only → auto-merges on green.

## Task U1b: Retire the WP equipment check-out zone

**Why:** the field half of the dead WP-attribution flow (usage = 0); operator: on-site staff not ready.

**Files:**
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` — remove the `WpEquipmentZone` import (~line 84) and its render (~line 643) + the `equipmentItems/Open/History` loads that feed only it (~lines 454-460; gate-check they feed nothing else).
- Delete: `src/components/features/equipment/wp-equipment-zone.tsx`, `tests/unit/wp-equipment-zone.test.tsx`
- Keep: `src/lib/equipment/usage-actions.ts` + `usage-rows.ts` dormant (append-only; no other caller after the zone is gone — gate-check with grep). Leave tables/RPCs untouched.

**Interfaces:** Produces: WP detail with no equipment zone; its data loads removed.

- [ ] **Step 1 — Gate-check:** `rg -n "WpEquipmentZone|wp-equipment-zone|checkOutEquipment|checkInEquipment|usage-actions" src` — confirm the only render is the WP page and the actions have no other caller.
- [ ] **Step 2 — RED:** WP-detail test asserting the equipment zone is absent → FAIL first.
- [ ] **Step 3 — Implement:** remove import/render/loads; delete component + test.
- [ ] **Step 4 — GREEN:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 5 — Verify:** dev-preview as PM/back-office, open a WP detail, confirm no equipment zone, other tabs intact, zero console errors.
- [ ] **Step 6 — Fresh-eyes + ship** (`ship-pr.sh`). Code-only.

## Task U1c: Rental forms → FAB + bottom-sheet (both rental pages)

**Why:** operator — forms off the list, into sheets; simplify the 587/501-line god components; one uniform record pattern (mirrors `/expenses` `add-expense-fab.tsx`).

**Files:**
- Create: `src/components/features/equipment/add-rental-fab.tsx` (`"use client"`) — FAB owning `open` state, hosts `BottomSheet` with the record-rental form; `onDone` closes. Mirror `add-expense-fab.tsx:1,21-22,33,46`.
- Create: `src/components/features/equipment/rental-deal-form.tsx` (`"use client"`) — the record-rental form extracted from `rental-manager.tsx:176-345` (supplier/rate/period/deposit/min-days/dates/project/note), `lockedProject` variant preserved.
- Create: `src/components/features/equipment/add-settlement-fab.tsx` + `rental-settlement-form.tsx` — settlement form extracted from `rental-settlement-manager.tsx` (`AmountInputs`/`MoneyField` move with it).
- Modify: `src/components/features/equipment/rental-manager.tsx` → shrink to the read-only deals list (`RentalCardRow` keeps its per-card allocate/void, but those open in a `BottomSheet` not an inline panel).
- Modify: `src/components/features/equipment/rental-settlement-manager.tsx` → read-only history list; correct/supersede opens in a sheet.
- Modify: `src/app/equipment/rentals/page.tsx` + `src/app/projects/[projectId]/rentals/page.tsx` → render list + FAB(s); pass suppliers/projects/defaultDate/rentals as plain props (the `/expenses` server→client seam). Project page keeps `lockedProject`.
- Test: `tests/unit/add-rental-fab.test.tsx`, `tests/unit/rental-deal-form.test.tsx`, `tests/unit/rental-settlement-form.test.tsx`.

**Interfaces:**
- `AddRentalFab({ suppliers, suggestedSupplierIds, projects, defaultDate, lockedProject? })` → renders FAB + sheet-hosted `RentalDealForm`.
- `RentalDealForm({ …same props, onDone }: { onDone: () => void })` → calls `createRentalBatch` / `createRentalAllocation`; on clean save `onDone()`.
- Settlement equivalents call `recordRentalSettlement` / `supersedeRentalSettlement`.
- Server actions in `src/app/equipment/rentals/actions.ts` are unchanged (reused).

- [ ] **Step 1 — Gate-check:** re-read `bottom-sheet.tsx` props (`open`/`title`/`onClose`/`side`/`wide`) + `add-expense-fab.tsx` wiring at HEAD; confirm signatures.
- [ ] **Step 2 — RED:** test that `AddRentalFab` renders a trigger, opening it shows the form, a clean submit calls `createRentalBatch` and closes (mock the action). FAIL first.
- [ ] **Step 3 — Implement** the FAB + extracted form; shrink the manager to a read-only list.
- [ ] **Step 4 — Repeat** RED→GREEN for the settlement FAB/form + the per-card allocate/void-in-sheet.
- [ ] **Step 5 — GREEN:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 6 — Real-flow verify:** dev-preview as procurement — on BOTH `/equipment/rentals` and `/projects/[id]/rentals`: FAB opens the sheet, record a deal, log a settlement, correct/void from a card; list is read-only; keyboard inset OK; zero console errors.
- [ ] **Step 7 — Fresh-eyes + ship** (`ship-pr.sh`). Code-only (`'use client'` justified in PR body).

## Task U1d: Settlement receipt attachment (schema — danger-path)

**Why:** the one concrete "log expenses properly" hole — store the vendor tax-invoice document, not just its number.

**Files:**
- Create: `supabase/migrations/<ts>_spec323u1d_rental_settlement_attachments.sql` — `rental_settlement_attachments` (id, settlement_id FK→rental_settlements, storage_path, purpose `office_expense_doc_purpose`-style enum or reuse, uploaded_by, uploaded_at; append-only; RLS on; `revoke all from anon, authenticated`; **no authenticated read/insert policy** — admin-client only) + a `rental-settlement-receipts` storage bucket policy scoped to the BACK_OFFICE writer. Claim the next schema number in LANES first.
- Create: `src/app/equipment/rentals/receipt-actions.ts` — `addRentalSettlementReceipt(settlementId, file, purpose)`: `requireRole(BACK_OFFICE_ROLES)` → admin client uploads to storage + inserts the metadata row (NOT the RLS client — the table is zero-grant, §Global Constraints).
- Create: `src/components/features/equipment/rental-receipt-uploader.tsx` — mirror `expense-receipt-uploader.tsx` UX (สลิป/ใบกำกับภาษี), wired to the admin action; lives in the settlement sheet / a per-settlement detail.
- Test: pgTAP `supabase/tests/database/323-rental-settlement-attachments.sql` (append-only + zero-grant asserts); `tests/unit/rental-receipt-uploader.test.tsx`.

**Interfaces:** `addRentalSettlementReceipt(settlementId: string, file: File, purpose: "payment_slip" | "tax_invoice"): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1 — Lane/schema claim** (next `075804+` in LANES) + gate-check `office_expense_attachments` migration + `expense-receipt-uploader.tsx` as the UX (not the RLS) reference.
- [ ] **Step 2 — RED (pgTAP):** assert the table is append-only (UPDATE/DELETE raise) + zero-grant to `authenticated`. Run `pnpm db:test` → FAIL (table absent).
- [ ] **Step 3 — Migration:** write it; `pnpm db:push` (auto-Y); `pnpm db:types`.
- [ ] **Step 4 — GREEN (pgTAP):** `pnpm db:test` → the new file passes; known-reds unchanged.
- [ ] **Step 5 — Action + uploader** RED→GREEN (vitest): a mocked upload calls the admin path and inserts a row.
- [ ] **Step 6 — Verify:** dev-preview as procurement — attach a สลิป to a settlement, confirm it stores + lists; site_admin cannot reach the surface.
- [ ] **Step 7 — Fresh-eyes + ship** (`ship-pr.sh`). **Danger-path (migration + storage RLS) → operator-merged.**

---

# PHASE 2 — Project lens (outline; detail at build)

**U2 — `<ProjectLens>` component.** Extract spec 311 U1's `?project=` chip row + `loadProjectNames` + per-row project tag into a reusable client component + a server helper. Files: `src/components/features/common/project-lens.tsx` + `src/lib/nav/project-lens.ts` (or co-locate). Reference: the spec 311 U1 implementation on `/requests` (`buildSiteProjectChips`). Code-only; RED-first on the chip render + URL-param narrowing. Detailed when built (depends on the 311 U1 code at HEAD).

# PHASE 3 — STR Home + tabs (outline; SERIALIZES with spec 313)

**U3.** Procurement Home hub (per-project status strip + 3 STR sections) + collapse `PROCUREMENT_TABS`/`PROCUREMENT_MANAGER_TABS` to the STR spine + re-home the คำขอสมัคร queue as a Home nudge. Touches `role-home.ts`, `bottom-tab-bar.tsx`, nav guards, `ui-conventions.md §12`, `site-map.md`. **Do not start until the nav lane (313) is free or explicitly co-sequenced**; map the CURRENT nav at build time (313 is changing it), then change the map + update its guards deliberately. Danger-path.

# PHASE 4 — Procurement-scoped relocate + apply lens (outline)

**U4.** Procurement-scoped visibility change in `settings/sections.ts` (remove rental/equipment/catalog/vendors/subcontractors/ordering-templates/expenses from **procurement's** view; other roles unchanged) + surface them under the STR homes + apply `<ProjectLens>` to incoming/POs/reports/expenses + update `ui-conventions.md §12` (procurement exception to rule 8) + nav-law guard. Depends on U2 + U3. Coordinate `labels.ts` with lane 321.

# PHASE 5 — Payroll project lens (outline)

**U5.** Apply `<ProjectLens>` to `/payroll` (spec 311 P0 — wages project-blind today). Money/danger-path. Depends on U2.

---

## Self-review (against spec §7)

- **U1 (spec)** → split into U1a (drop card) + U1c (sheets, both pages) + U1d (receipt). U1b (WP zone) is its own task. ✔ covers spec U1 + U1b.
- **U2/U3/U4/U5** → Phases 2–5. ✔
- **Invariants** — U1d's attachment write goes through the admin client behind the gate, NOT a granted policy (spec §6 inv.1 + the review's HIGH finding). ✔
- **Both rental pages** — U1c names `/projects/[id]/rentals`. ✔
- **Tests to delete** — named in U1a/U1b. ✔
- **Nav serialization** — Phase 3 flagged, gated on lane 313. ✔
- Type consistency — `AddRentalFab`/`RentalDealForm`/`addRentalSettlementReceipt` signatures defined once, reused. ✔
