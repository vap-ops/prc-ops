# Spec 202 — Equipment usage UI: activate the dormant rental economics

**Status:** U1 building — 2026-06-25. **Driver:** the 2026-06-25 material/equipment
lifecycle review found that spec 146 (P2 rental money, ADR 0055 decision 5) shipped
**all** of its DB plumbing — `equipment_items.daily_rate`, the
`set_equipment_daily_rate` / `create_equipment_rental_batch` /
`create_equipment_project_allocation` / `check_out_equipment` / `check_in_equipment`
RPCs, `wp_equipment_sell`, and the `wp_profit` fold — **plus** the pure validators in
`src/lib/equipment/` — but **zero UI and zero call sites**. The validators are
orphaned (built test-first, never wired). Net effect: `equipment_usage_logs` is
**unpopulatable from the app**, so `wp_equipment_sell` always returns 0 and
`wp_profit` reports `equipment_cost = ฿0` while asserting `equipment_costed = true`.
The ADR 0055 economics (PRC rents from the sister co, charges WPs a daily transfer
price) cannot be exercised.

This spec is the **UI activation** spec 146 sketched as "U5" but bundled with
budget-vs-spend. It decomposes the dormant surface into dependency-ordered,
separately-shippable units and folds in the two coherence guards (F2/F3) the review
surfaced. The hard part already exists, so each unit is mostly **wiring**.

**Money posture is unchanged and binding** (ADR 0055 decision 6 / spec 46):
`daily_rate` and `daily_rate_snapshot` are zero-authenticated-grant money, read only
via the admin client for the `pm/super/procurement/project_director` audience, and
**never on a site_admin-reachable screen**. The check-out/check-in surface is
deliberately **rate-free** so the field can use it without seeing money — exactly the
`log_labor_day` / `labor_logs.day_rate_snapshot` posture.

---

## Roadmap (units, dependency-ordered)

| Unit   | Ships                                                                                                                                                                                    | DB?           | Depends on        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------- |
| **U1** | **Per-item daily-rate UI on `/equipment`** (money audience only; admin-read; `setEquipmentDailyRate` → `set_equipment_daily_rate`). **The unit specced + built below.**                  | **No**        | spec 146 U1       |
| U2     | **Check-out / check-in control on WP detail** (rate-free field surface; `check_out_equipment` / `check_in_equipment`). The value driver — this is what populates `equipment_usage_logs`. | No            | U1 (priced items) |
| U3     | **Coherence guards (F2 + F3).** `check_out_equipment` rejects an item not physically on hand; check-out flips `equipment_items.status → 'in_use'`, check-in restores it.                 | **Yes** (RPC) | U2                |
| U4     | Rental-batch UI on `/equipment` (`create_equipment_rental_batch`; `validateRentalBatch` already exists) + active-batch list (admin-read).                                                | No            | spec 146 U1       |
| U5     | Project-allocation UI (`create_equipment_project_allocation`; `validateAllocation` exists) — commit a batch to a project.                                                                | No            | U4                |
| U6     | Budget-vs-spend equipment surface (the live `wp_equipment_sell` already feeds `wp_profit`; expose it) + the ADR 0051 owner portal.                                                       | maybe         | U1–U5             |

U2 is the highest-value unit (without it, usage logs stay empty and `wp_profit`'s
equipment term is permanently 0). U1 ships first because `check_out_equipment` rejects
an unpriced item (`daily_rate is null` → "price it first") — pricing is the dependency
root, and it is pure app code (the RPC exists), so it carries **zero schema risk**.

The materials-side review finding **F4** (`record_stock_in` does not enforce
`stockable = false`, so a made-to-order item can be wrongly received into the store) is
a separate one-line follow-up, **not** in this spec — recorded so it is not lost.

---

## U1 — per-item daily-rate UI on `/equipment` (2026-06-25)

**Status:** building. **No schema** — `set_equipment_daily_rate` (spec 146 U1) and
`validateEquipmentDailyRate` already exist; this unit is the missing UI + action that
call them. Pure app code → auto-merge eligible.

### What ships

- **Action — `setEquipmentDailyRate({ id, rate })`** in `src/app/equipment/actions.ts`,
  **mirroring `setItemSellRate`** (spec 178 U5): `requireRole(BACK_OFFICE_ROLES)`
  (defense-in-depth; the `set_equipment_daily_rate` definer carries the real gate —
  its final gate is `pm/super/procurement/project_director` = `BACK_OFFICE_ROLES`,
  confirmed in `20260751000000`), UUID-check `id`, reject non-finite/negative `rate`,
  call `supabase.rpc("set_equipment_daily_rate", { p_id, p_rate })`, map `42501` →
  "ไม่มีสิทธิ์" and `P0001` → "ไม่พบอุปกรณ์นี้ หรือค่าเช่าไม่ถูกต้อง" (the RPC raises
  `P0001` for both not-found and invalid-rate — unlike the catalog RPC's `22023`),
  `revalidatePath("/equipment")`.

- **Component — `SetDailyRate`** (`src/components/features/equipment/set-daily-rate.tsx`),
  **mirroring `SetSellRate`**: a money-control button showing `฿{rate}/วัน` (the current
  rate, money) or `EQUIPMENT_SET_DAILY_RATE_LABEL` when null, opening a `BottomSheet`
  with a numeric input → `setEquipmentDailyRate` → `router.refresh()`. Pure-number guard
  before the action (`validateEquipmentDailyRate` mirror: finite, `>= 0`).

- **Labels** (`src/lib/i18n/labels.ts`, SSOT) — `EQUIPMENT_DAILY_RATE_LABEL = "ค่าเช่า/วัน"`,
  `EQUIPMENT_SET_DAILY_RATE_LABEL = "ตั้งค่าเช่า/วัน"`, next to the spec-178 sell-rate labels.

- **Wiring — `EquipmentManager` / `EquipmentRow`** gain an optional
  `dailyRates?: Record<string, number | null>` prop (the money map). `EquipmentRow`
  renders `<SetDailyRate>` in its action cluster **only when
  `canManageRegistry && dailyRates`** — `canManageRegistry` is already
  `BACK_OFFICE_ROLES.includes(role)`, the exact money audience, so site_admin (the only
  `EQUIPMENT_MOVE_ROLES` role outside it) never receives or renders a rate.

- **Page — `/equipment`** reads each item's `daily_rate` **via the admin client, only
  when `canManageRegistry`** (the `acquisition_cost`/sell-rate admin-read pattern), builds
  the `dailyRates` record, and passes it to `EquipmentManager`. For the field view the
  prop is omitted entirely (`exactOptionalPropertyTypes` — no `undefined` rate reaches the
  client).

### Scope

- **IN:** the `setEquipmentDailyRate` action; the `SetDailyRate` component; the two labels;
  the `dailyRates` prop threading; the page admin-read. Tests below.
- **OUT:** check-out/check-in (U2); the F2/F3 guards (U3); rental-batch / allocation UI
  (U4/U5); any budget-vs-spend or owner surface (U6); **clearing** a rate to null (the RPC
  rejects null, like the labor precedent); rate history/changelog UI (the `audit_log` rows
  exist; no reader this unit).

### Money posture

`daily_rate` stays zero-authenticated-grant: read via the admin client for
`pm/super/procurement/project_director` only, rendered only under `canManageRegistry`,
written through the audited `set_equipment_daily_rate` definer. Never on the site_admin
field view. Identical to the catalog sell-rate.

### Tests

- **TDD (RED first):** `tests/unit/set-daily-rate.test.tsx` (mirror
  `set-sell-rate.test.tsx`) — prompts to set when `currentRate` null; shows `฿{rate}/วัน`
  when set; submitting calls `setEquipmentDailyRate({ id, rate })` and refreshes. State
  **"Writing failing test first."**
- **Extend `tests/unit/equipment-manager.test.tsx`:** with `dailyRates` + `canManageRegistry`
  the `ตั้งค่าเช่า/วัน` control shows; with `canManageRegistry = false` it does **not**
  (the money-posture guard — a rate control must never appear on the field view).

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green. **No DB** (no `db:push`/`db:test`).
Operator on-device: as a PM/super, open `/equipment`, set a daily rate on an item, confirm
it persists; as a site_admin confirm **no** rate control or value is visible.

### Seams

- The check-out/check-in surface (U2) is what makes a set rate _do_ anything — until then a
  rate is recorded but unused. U1 deliberately ships the dependency root alone (priced items)
  so U2 is a clean rate-free field surface.
- Rate **history** (the `equipment_rate_change` audit rows) has no reader — a later admin
  surface, with the rental-batch/allocation money views (U4/U5).
