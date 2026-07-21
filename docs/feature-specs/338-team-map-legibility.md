# Spec 338 — Team-map legibility: trades on the map, HT visibility, contractor identity, button hierarchy

**Status:** approved (operator, 2026-07-22 in-chat, with mockup)
**Depends on:** spec 330 (the map, `/projects/:id/team`), spec 332 (`worker_trades` — mig `075821`, LIVE), spec 277 (`CategoryChip` identity SSOT)
**Schema:** NONE. Code-only. This is spec 332's named follow-up ("surface trades on team-map member chips").

## Why

Operator named four pains on the team map (2026-07-22):

1. **Hard to distinguish PRC technicians from subcontractors.** The data is present (`chip.contractorId`, `card.kind`) but renders as one grey subtitle line; cards and chips are otherwise identical.
2. **Cannot tell who has the HT badge.** The lead band renders only when a card is expanded; cards collapse by default, so the map shows team names and counts with zero HT.
3. **Cannot tell which team can do what kind of work.** Operator's model (locked in chat): capability follows the HT — a team can do what its lead's trades say. The trade data now exists per worker (`worker_trades`, W01–W09 top-level, primary flag). The map renders none of it.
4. **The buttons all look the same.** Three shared class constants style every action identically — ยุบทีม (destructive) renders exactly like บันทึกชื่อ (primary), จัดการทีม like ซ่อน/แสดง.

Model decisions locked by the operator 2026-07-22:

- Capability lives **on the worker** (trade tags), not on the crew. Team capability = the **lead's** trades, derived at render. A leadless crew honestly shows no capability (the existing ยังไม่ตั้งหัวหน้าทีม prompt already flags it).
- One HT can hold **multiple** trades (332's junction already allows it; primary-first ordering).
- **No hard gate** on who can be made lead — the pilot crews' leads have no trades yet; a gate would fight adoption.
- **Writes stay in one home.** The trade editor is spec 332's roster sheet on `/workers` (page gate = WORKER_ROSTER_ROLES; the trade-edit control itself is PM_ROLES — fact-checked). The map READS trades and links out to edit; it does not grow a second editor. The map's whole audience (PM_ROLES) can reach the editor.

## Contracts this spec builds on (gate-checked 2026-07-22 against HEAD + live)

- `worker_trades` Row: `worker_id, work_category_id (uuid), is_primary, created_by, created_at`; RLS select-for-authenticated, writes RPC-only. Join shape used by `/workers`: `worker_id, work_category_id, is_primary, work_categories(code, name_th)`.
- `sortTradesPrimaryFirst` + `WorkerTrade` type in `src/lib/workers/trades.ts` (pure, reusable).
- `CategoryChip({ code, label?, className? })` in `src/components/features/work-packages/category-chip.tsx` — icon-only tile when `label` omitted; returns `null` for unknown/blank code.
- `workCategoryIdentity(code)` resolves 5-char subsection codes to their top (spec 226 grain) and `null` for uncategorised.
- `work_packages.category_id (uuid | null)` FK targets **`project_categories.id`** (fact-checked live 2026-07-22 — NOT `work_categories`); the firm W-code is two hops away: `work_packages → project_categories → project_categories.work_category_id → work_categories.code`. The PostgREST embed is therefore `project_categories(work_categories(code))`. `project_categories.code` is a separate per-project editable text column and must NOT be used as the taxonomy code.
- House button tokens in live use: primary = `bg-action text-on-fill`; danger = `border-edge-strong bg-card text-danger hover:bg-danger-soft` (wp-delete-control pattern); all raw-palette classes remain banned (design-doctrine guard).
- `src/lib/team-map/` is in the CI danger deny-regex (#662). **This spec does not touch it.** Trades and WP categories ride page-level props into `TeamMapView`.

## U1 — Card identity + button hierarchy (view-only)

**Files:** `src/components/features/team-map/team-map-view.tsx`, tests.

1. **Firm cards** get a distinct surface: `border-edge-strong` full border + a ผู้รับเหมา badge pill in the header row (BADGE class + `border-edge-strong` border), keeping Building2. Member chips inside firm cards render **dashed-outline** style (`border border-dashed border-edge-strong bg-card`) instead of the solid `bg-sunk` chip — the PRC/subcon distinction at chip grain.
2. **Crew cards** keep the solid look (`ทีม PRC` subtitle stays). Pool keeps its dashed card border (already distinct).
3. **Button tiers** — three explicit class constants replace the flat uniformity:
   - `BTN_PRIMARY` (`bg-action text-on-fill` pill): the ONE per-tier constructive action — ตั้งทีมใหม่ (tier header), สร้างทีม (create sheet), บันทึกชื่อ (manage sheet).
   - Secondary (existing `TIER_ACTION` / `SHEET_ACTION` bordered look): เพิ่มสมาชิก, จัดการทีม, move/add targets, ตั้งเป็นหัวหน้าทีม, ตั้งเป็น SA หลัก.
   - `BTN_DANGER` (wp-delete-control pattern: bordered, `text-danger`, `hover:bg-danger-soft`): ยุบทีม, นำออกจากทีม, ถอดออกจากทีมโครงการ, นำตัวเองออก.
   - ซ่อน/แสดง toggles stay plain text (`TOGGLE`), unchanged.

**Failure modes:** none at runtime (pure render). Regression risk = tier drift.
**Tests (RED-first):** RTL — ยุบทีม button carries `text-danger` and ตั้งทีมใหม่ carries `bg-action`; firm-card chip carries `border-dashed` while crew-card chip does not. Mutation-check: revert one tier class by hand → exactly the targeted assert reds.

## U2 — Trades on the map (read layer)

**Files:** `src/app/projects/[projectId]/team/page.tsx`, `src/components/features/team-map/team-map-view.tsx`, `src/lib/workers/trades.ts` (additive pure helper), `src/lib/i18n/labels.ts` (additive), tests.

1. **Page fetch (server, RLS client):** `worker_trades` rows joined `work_categories(code, name_th)` for the project's workers, folded to `tradesByWorker: Record<workerId, WorkerTrade[]>` primary-first (new pure `foldWorkerTrades(rows)` beside `sortTradesPrimaryFirst`). Passed to `TeamMapView` as an optional prop — builder (`src/lib/team-map/`) untouched.
2. **Lead band (expanded crew card):** `CategoryChip` icon-only tiles after the lead's name, primary first.
3. **Collapsed crew card:** a lead line renders while collapsed — ★ + lead name + tiles (the pain-2 fix: HT visible without expanding). Leadless crews keep the existing ยังไม่ตั้งหัวหน้าทีม prompt; no new empty state.
4. **Pool + member chips:** a chip whose worker has trades shows the PRIMARY tile only (compact; spare HTs in the pool become spottable). Non-primary trades stay in the sheet.
5. **Worker chip sheet:** a สายงาน row — full tiles + Thai names (`CategoryChip` with `label`), read-only. For the map's own audience (PM_ROLES already gates the page) a link แก้ไขสายงานที่รายชื่อช่าง → `/workers` (the 332 editor home). New label `TRADE_SECTION_LABEL = "สายงาน"` in labels.ts only if the string lands on 2+ surfaces; otherwise inline.

**Failure modes + recovery:**

- Worker with no trades → no tiles, no placeholder (data still filling; absence is not an error). Sheet shows the link only (PM can go tag them).
- Unknown / subsection / blank code → `CategoryChip` returns `null` by contract; nothing renders. No crash path.
- `worker_trades` fetch failure → prop omitted → tiles absent everywhere, no error surface (a read decoration degrades silently). The collapsed lead LINE does not depend on the fetch — pain 2 (HT visibility) stands alone and renders from the map data whenever a crew has a lead.

**Tests (RED-first):** fold helper (primary-first, dedup-safe); RTL — lead band renders tiles primary-first; collapsed card shows lead name + tile; pool chip shows primary tile only; chip sheet lists all trades + the /workers link; a worker with zero trades renders no tile. Mutation-checks: presence pins use ≥2-occurrence or render asserts, never bare `toContain` on source.

## U3 — Placing trade-mismatch hint (soft, never blocking)

**Files:** `src/lib/work-plans/day-assignments.ts` (additive field), `src/app/projects/[projectId]/team/page.tsx` (fetch category codes), `src/components/features/team-map/team-map-view.tsx`, `src/lib/i18n/labels.ts`, tests.

1. `DayPlanWpItem` gains optional `categoryCode?: string | null` (the WP's firm `work_categories.code`, raw; top-resolution happens at render via `workCategoryIdentity`). `loadDayPlan` selects it through the existing `work_packages(...)` join via the TWO-HOP embed `project_categories(work_categories(code))` (see contracts above).
2. **Placing mode:** while a WP is picked up, a crew card offering วางที่ทีมนี้ shows a soft hint line when ALL hold: the item has a resolvable top category · the crew has a lead · the lead has ≥1 trade · the WP's top code ∉ lead's trade codes. Hint = `TRADE_MISMATCH_HINT = "หัวหน้าทีมยังไม่มีสายงานนี้"` + the WP's category tile. The drop button stays fully tappable — advisory only.
3. **Assigned plan-chip sheet:** the same hint line under the WP name when the assigned team mismatches by the same rule.

**Failure modes + recovery:**

- WP uncategorised (legacy rows) → no hint (cannot claim a mismatch).
- Leadless crew or lead without trades → no hint (absence of data ≠ incapability; the map must not scold while the roster is still being tagged).
- The hint must NEVER block or disable the write — a wrong hint costs a glance; a wrong block costs a work assignment.

**Tests (RED-first):** hint predicate as a pure function (all four gate conditions, subsection code resolves to top); RTL — mismatch renders hint while the drop button stays enabled; match/no-data renders none. Mutation-check: invert the predicate → targeted reds.

## Out of scope (listed so review rejects drift)

- Any write path, any `src/lib/team-map/` edit, any schema.
- Trades on firm cards (firm teams are lead-less by design; revisit after the 328 pilot).
- Sorting/filtering the lead picker by trades (follow-up when trade fill-rate is real).
- Muster cockpit / roster surfaces (this spec is the map; chip reuse comes later).
- The trade-vs-firm card grain question from the 19/07 daily report (parked with 330 U4).

## Verification checklist

- `pnpm lint && pnpm typecheck && pnpm test` green per unit.
- Guard suites locally: design-doctrine (token classes only), feature-components-structure, ui-class-contracts.
- Real-flow: dev-preview login → `/projects/PRC-2026-004/team` — firm card visually distinct; collapsed crew shows lead + tiles once a pilot lead is tagged; chip sheet shows trades + link; placing an uncategorised WP shows no hint; ยุบทีม reads as danger. Zero console errors.
- Fill-rate follow-up (doctrine): after the pilot week, `select count(*) from worker_trades` — if still 0, the read layer is starved and the /workers editor needs a nudge surface, not more map UI.
