# Spec 268 — Equipment rental recording: /equipment/rentals + rate period

**Status:** in progress — 2026-07-05. **Driver:** the procurement team requested
an equipment-rental feature — rent gear **for the whole project** or for a
**custom duration**. The spec-146 rental-money backend (ADR 0055 decision 5)
shipped complete — `equipment_rental_batches`, `equipment_project_allocations`,
`create_equipment_rental_batch` / `create_equipment_project_allocation`
definers, validators — but spec 202 stopped at U3, so **U4/U5 (batch +
allocation UI) never shipped**: both tables sit at **0 rows** live (missing-
feature audit G17). This spec is that activation plus one honest-data
refinement: a rental deal can be priced **per month or per day**
(`rate_period`), because short custom-duration rentals (pump, crane) are
day-priced in the real world and forcing them into `monthly_rate` records a
wrong number.

**Model recap (unchanged, ADR 0055):** a **batch** = the inbound deal (owner,
rate, period; PRC's cost). An **allocation** = that deal committed to a
project for a period. "Whole project" = an **open-ended** period
(`ends_on null` — runs until returned); "custom duration" = explicit
`starts_on`/`ends_on`. Charge-out to WPs stays the independent per-item
`daily_rate` (Case A) — untouched here.

**Money posture (binding, ADR 0055 decision 6):** batches + allocations are
zero-authenticated-grant money tables — read **only** via the admin client
behind `requireRole(BACK_OFFICE_ROLES)` (pm / super_admin / procurement /
procurement_manager / project_director — matches the live RPC gates), never on
a site_admin-reachable screen. The new route is gated to exactly that
audience; `/equipment` (field-visible) gains only a money-audience-only link.

---

## U1 — schema: `equipment_rate_period` (additive, single migration `20260813071900`)

- **Enum `public.equipment_rate_period`** — `monthly | daily`. `CREATE TYPE`
  is transactional (the enum-add **isolation** rule binds `ALTER TYPE …
ADD VALUE`, not `CREATE TYPE`), so the enum, column, and RPC ship in ONE
  migration.
- **`equipment_rental_batches.rate_period equipment_rate_period not null
default 'monthly'`** — additive; live table has 0 rows, and the default
  keeps the old meaning for any historical caller.
- **RPC widen — `create_equipment_rental_batch` gains trailing
  `p_rate_period public.equipment_rate_period default 'monthly'`.**
  New arity ⇒ **DROP the 5-arg, CREATE the 6-arg** (leaving both would make
  named-notation calls ambiguous — the spec-217 DROP/CREATE precedent). Body
  **re-sourced VERBATIM from LIVE** (`pg_get_functiondef`, the 071000 parity-
  sweep body with the 5-role gate incl. `procurement_manager`) with exactly
  three additions: a `p_rate_period is null → P0001` guard, `rate_period` in
  the INSERT, and `rate_period` in the audit payload. Re-establish grants:
  `revoke all from public; grant execute to authenticated` (pgTAP file 100
  asserts anon=false/authenticated=true — pins updated to the 6-arg
  signature).
- `monthly_rate` keeps its name (a rename is a destructive break-glass;
  the column now means "rate in the unit `rate_period` names" — documented
  via `comment on column`).
- **pgTAP:** update the two signature pins in
  `100-anon-exec-definer-harden.test.sql`; new file
  `268-equipment-rental-rate-period.test.sql` — enum + labels; column,
  not-null, default `monthly`; 5-arg signature GONE, 6-arg present; anon
  denied / authenticated granted on the 6-arg; a positional legacy-shape call
  records `monthly`; an explicit `daily` call records `daily` and the audit
  payload carries it; site_admin + visitor still `42501`; null rate_period →
  `P0001`.
- `pnpm db:types` regenerated (src + worker).

## U2 — UI: `/equipment/rentals` (code, same PR)

- **Page** `src/app/equipment/rentals/page.tsx` —
  `requireRole(BACK_OFFICE_ROLES)`. Reads: **admin client**
  `equipment_rental_batches` + `equipment_project_allocations` (money);
  **RLS client** `equipment_owners` + `projects` (names). Assembles the view
  server-side, renders `RentalManager`. `DetailHeader backHref="/equipment"`.
- **Pure view model** `src/lib/equipment/rental-view.ts` (**TDD first**):
  `rentalRateLabel(rate, period)` (`฿…/เดือน` | `฿…/วัน`, via the format-SSOT
  `bahtWithSymbol`), `rentalPeriodLabel(startsOn, endsOn)` (dated span vs
  open-ended → "ตลอดโครงการ (จนกว่าจะคืน)"), `buildRentalView(batches,
allocations, owners, projects)` → newest-first cards with per-batch
  allocation chips.
- **Actions** `src/app/equipment/rentals/actions.ts` —
  `createRentalBatch({ ownerId, rate, ratePeriod, startsOn, endsOn, note,
projectId })`: `requireRole(BACK_OFFICE_ROLES)` (defense-in-depth; the
  definer re-gates), UUID + enum-membership + `validateRentalBatch` guards,
  RPC `create_equipment_rental_batch` (now with `p_rate_period`); when
  `projectId` is set, chain `create_equipment_project_allocation` with the
  same period (the one-form "rent for project X" path). A failed second step
  reports "batch saved, allocation failed" honestly (no fake rollback).
  `createRentalAllocation({ batchId, projectId, startsOn, endsOn })`:
  `validateAllocation` + the allocation RPC. Error mapping `42501`/`P0001` →
  Thai; `revalidatePath("/equipment/rentals")`.
- **Component** `RentalManager`
  (`src/components/features/equipment/rental-manager.tsx`, `'use client'` —
  form + busy/error state): record form (owner select · rate + **ต่อเดือน /
  ต่อวัน** RadioChip · duration RadioChip **ตลอดโครงการ** [no end date] /
  **กำหนดช่วงเอง** [start+end inputs] · start date defaulting to Bangkok
  today · optional project select = allocate-on-create) + the rentals list
  (owner, rate label, period label, note, allocation chips, per-card
  **ผูกโครงการ** inline form).
- **Labels (SSOT)** — `EQUIPMENT_RENTAL_LABEL "เช่าอุปกรณ์"`,
  `EQUIPMENT_RATE_PERIOD_LABEL: Record<'monthly'|'daily'>` =
  ต่อเดือน / ต่อวัน, `EQUIPMENT_RENTAL_WHOLE_PROJECT_LABEL "ตลอดโครงการ"`,
  `EQUIPMENT_RENTAL_CUSTOM_PERIOD_LABEL "กำหนดช่วงเอง"`,
  `EQUIPMENT_RENTAL_ALLOCATE_LABEL "ผูกโครงการ"`.
- **Nav:** settings hub master-data section (`sections.ts`) gains
  **เช่าอุปกรณ์** → `/equipment/rentals` right after อุปกรณ์ (back-office
  visibility — the hub-nav strip is deliberately NOT widened; the operator
  has flagged strip clutter before). `/equipment` page shows a
  money-audience-only link chip to การเช่า (`canManageRegistry`).

## Scope

- **IN:** U1 migration + pgTAP + types; the page, view model, two actions,
  `RentalManager`, labels, settings entry, `/equipment` link; vitest
  (view-model + component, TDD-first).
- **OUT:** ending/early-terminating a batch or allocation (`ends_on` edit
  RPC — recorded seam, unchanged from spec 146); batch payment / GL posting
  (ADR 0055 open question — PEAK/spec-129 territory); rental cost reports or
  per-project rollups (future read unit); owner portal (spec 146 U6);
  editing/superseding a batch (correction = new batch + note, per spec 146);
  hub-nav strip changes; touching `wp_equipment_sell`/`wp_profit`
  (charge-out side untouched).

## Tests

- **TDD RED first:** `tests/unit/rental-view.test.ts` (rate label monthly +
  daily; period label dated + open-ended; view assembly: owner/project name
  join, newest-first, allocation chips) and
  `tests/unit/rental-manager.test.tsx` (defaults = monthly + whole-project,
  end-date hidden; custom period reveals end date; submit shape incl.
  `ratePeriod`/`projectId: null`; project pick passes id; per-card
  ผูกโครงการ → `createRentalAllocation` shape; empty state). State "Writing
  failing test first."
- **pgTAP:** file 268 (above) + the two file-100 pin updates, written before
  `db:push`.

## Verification

`pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:push` →
`pnpm db:test` green; `pnpm db:types` reconciled (src + worker). Auth-gated
surface → verified-by-checklist + live-DB spot insert; operator on-device
pass = acceptance (record a monthly whole-project rental and a daily
custom-duration rental, see both cards + allocation chips; confirm a
site_admin session cannot reach `/equipment/rentals`).

## Seams

- Ending a rental early (set `ends_on`) — small edit RPC, next unit if asked.
- Per-project rental **cost** rollup (batches × months / days) — a read unit
  once deals exist; nothing computes batch cost today.
- `validateRentalBatch`'s `monthlyRate` field name is now generic "rate" —
  kept to avoid churning its call/test surface; rename rides the next touch.
