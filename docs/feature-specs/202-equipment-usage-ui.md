# Spec 202 — Equipment usage UI: activate the dormant rental economics

**Status:** U1·U2 shipped · U3 building (schema — flag before push) — 2026-06-25. **Driver:** the 2026-06-25 material/equipment
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

**Status:** SHIPPED to prod 2026-06-25 (`c6c1217`, no DB; lint·typecheck·vitest green).
**No schema** — `set_equipment_daily_rate` (spec 146 U1) and
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

---

## U2 — check-out / check-in equipment on the WP detail page (2026-06-25)

**Status:** SHIPPED to prod 2026-06-25 (no DB; lint·typecheck·vitest green).
**No schema** — `check_out_equipment` / `check_in_equipment`
(spec 146 U3) already exist; this unit is the missing **อุปกรณ์** tab that calls them.
The value driver: this is the surface that actually populates `equipment_usage_logs`,
so `wp_equipment_sell` (and `wp_profit`'s equipment term) stops being structurally 0.
Mirrors the **ทีมงาน** (labor) tab — a **rate-free field surface**: the field records
check-out/check-in, the definer snapshots the rate server-side, the screen never shows
money (`daily_rate_snapshot` is omitted from the read, like `labor_logs.day_rate_snapshot`).

### What ships

- **Pure helper — `splitEquipmentUsage(rows)`** (`src/lib/equipment/usage-rows.ts`,
  **TDD first**): applies the supersede anti-join (current = no newer row whose
  `superseded_by` points at it) and partitions current rows into `open`
  (`checked_in_on === null`, sorted by check-out date) and `history`
  (`checked_in_on !== null`, most recent first). Mirrors `current-location.ts` —
  compiles before `db:types`, no money.

- **Actions** (`src/lib/equipment/usage-actions.ts`, mirroring `src/lib/labor/actions.ts`):
  - `checkOutEquipment({ workPackageId, itemId, checkoutDate, revalidate })` →
    `supabase.rpc("check_out_equipment", { p_item, p_wp, p_date })`. UUID + `/`-prefix +
    ISO-date shape guards; relays to the RPC (the gate/serialisation/rate-snapshot are
    the DB's). Maps the RPC's `P0001` messages → Thai: already-checked-out, **no daily
    rate ("ตั้งราคาก่อน" — ties to U1)**, WP complete; `42501` → no-permission.
  - `checkInEquipment({ logId, checkinDate, revalidate })` →
    `check_in_equipment(p_log, p_date)`. Maps already-closed/superseded and
    check-in-before-check-out → Thai.
  - RLS server client (the definer runs under the caller's session, like the labor
    actions); `revalidatePath` on success.

- **Component — `WpEquipmentZone`** (`src/components/features/equipment/wp-equipment-zone.tsx`,
  `'use client'`, mirroring `LaborLogZone` minus money/roster complexity). Props:
  `workPackageId`, `revalidate`, `items` (`{ id, name, assetTag }[]` — rate-free),
  `open` / `history` (`splitEquipmentUsage` output), `itemNames` (id → name), `locked`,
  `defaultDate` (Bangkok today, server-computed). Renders:
  - **Check-out form** (hidden when `locked`): a date input (default today) + an item
    `<select>` listing items **not currently checked out** + a เช็คเอาท์ button →
    `checkOutEquipment`.
  - **กำลังใช้งาน** (currently out): each open row = item name + check-out date + (when
    not `locked`) a **คืน** control revealing a date input → `checkInEquipment`.
  - **ประวัติ** (history): closed rows, read-only (`{out} – {in}`). Empty states.
  - **No money anywhere** — no rate column requested or shown.

- **Labels** (`src/lib/i18n/labels.ts`, SSOT): `EQUIPMENT_TAB_LABEL = "อุปกรณ์"`,
  `EQUIPMENT_CHECK_OUT_LABEL = "เช็คเอาท์"`, `EQUIPMENT_CHECK_IN_LABEL = "คืน"`,
  `EQUIPMENT_IN_USE_LABEL = "กำลังใช้งาน"`.

- **Wiring — WP detail page** (`…/work-packages/[workPackageId]/page.tsx`): two reads
  ride the existing `Promise.all` — `equipment_items (id, name, asset_tag)` and
  `equipment_usage_logs (id, item_id, checked_out_on, checked_in_on, superseded_by)` for
  this WP (RLS client, **no money column**, readable by every `WP_DETAIL_ROLES` role). A
  new **อุปกรณ์** tab is inserted after ทีมงาน, `locked = readOnly || status==='complete'`
  (the labor posture: procurement reads history, the field checks out); `hashTabMap` gains
  `"wp-equipment": "equipment"`.

### Scope

- **IN:** the pure helper, the two actions, the `WpEquipmentZone` component, the four
  labels, the page reads + tab. Tests below.
- **OUT:** a **correction/cancel** of a usage span (the `superseded_by` + `correction_reason`
  columns exist; a `correct_equipment_usage` RPC + UI is a later seam — check-in already
  closes an open span); filtering the item picker by the item's **movement-derived project**
  (a U3/seam refinement — for now the picker lists all visible items, the RPC guards rate +
  one-open-checkout); the F2/F3 status/location guards (**U3**, an RPC migration); any money
  display; bulk/quantity checkout; half-day proration (whole-day, per spec 146 U3).

### Money posture

The whole surface is **rate-free** and therefore site_admin-safe (unlike U1's pricing).
`daily_rate_snapshot` is never selected or shown; the field records spans only. Identical
to the ทีมงาน tab (`log_labor_day` snapshots the rate server-side; the screen shows none).

### Tests

- **TDD (RED first):** `tests/unit/equipment-usage-rows.test.ts` — `splitEquipmentUsage`:
  an open span surfaces in `open`; a checked-in span (open row superseded by a closed
  successor) surfaces in `history` (the closed successor, not the superseded open row);
  ordering. State **"Writing failing test first."**
- **`tests/unit/wp-equipment-zone.test.tsx`** (mock actions + router): the check-out form
  calls `checkOutEquipment` with `{ itemId, checkoutDate }`; an open row's คืน calls
  `checkInEquipment` with `{ logId, checkinDate }`; the picker omits an already-out item;
  `locked` hides the check-out form and คืน controls (history still shows).

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green. **No DB**. Operator on-device: price an
item (U1), then as a site_admin open a WP → อุปกรณ์ → check the item out, see it under
กำลังใช้งาน, check it back in, see it move to ประวัติ — all with **no money on screen**.

### Seams

- **Correction/cancel** of a usage span — not built (the supersede columns are in place).
- **Project-scoped item picker** — once movements drive deployment, filter the picker to
  items on this WP's project; for now it lists all visible items (the RPC still guards).
- **U3 (next):** the F2/F3 coherence guards — `check_out_equipment` rejects an item not
  physically on hand and flips `equipment_items.status` to/from `in_use`. That one carries
  an RPC migration (change-management gate), flagged before push.

---

## U3 — check-out coherence guards: F2 (physical availability) + F3 (in_use overlay) (2026-06-25)

**Status:** building. **SCHEMA** (change-management gate — flag before `db:push`). The two
latent bugs the 2026-06-25 lifecycle review surfaced, now that U2 made checkout reachable:
the two "where is it" systems (`equipment_movements` = project-grain custody;
`equipment_usage_logs` = WP-grain billing) had **no cross-check**, so you could bill a WP
for gear that's lost/returned, and `equipment_status='in_use'` was a dead enum value
(nothing set it). U3 closes both with a `CREATE OR REPLACE` of the two usage RPCs — **no
new table, column, grant, policy, or enum value**.

### Re-source discipline (binding)

The new bodies are sourced from the **LIVE** definitions in
`20260767000400_equipment_usage_director_gates.sql` (the latest — confirmed no later
redefinition), which carry the **five-role gate** `site_admin / project_manager /
project_director / procurement / super_admin` (ADR 0058, pgTAP 90/91). The F2/F3 lines are
**added** to that exact body — never re-derived from the pre-director `20260767000100`
original, or the director arm is dropped and the ADR-0058 slip returns.

### What ships

- **Migration `20260813001900_spec202u3_equipment_checkout_guards.sql`** — `CREATE OR
REPLACE` of both RPCs (grants preserved across replace; no DROP):
  - **F2 (check-out):** read `status` alongside `daily_rate`; after the priced check, reject
    when `status NOT IN ('available','on_site','in_use')` → `P0001` "equipment not on site
    (maintenance/returned/lost)". **`in_use` is allowed through** — a genuine `in_use` has an
    open span and is caught by the existing one-open-checkout guard with the precise "already
    checked out" message; a manually-set `in_use` with no open span is legitimately
    checkout-able. Placed before the WP checks (item validity grouped).
  - **F3 (check-out):** after the insert, `update equipment_items set status='in_use'`. A
    **best-effort overlay, NOT authoritative** — any later `equipment_movements` row
    re-derives status via its trigger and clobbers it; the open usage log stays the source of
    truth for "is it out". Documented as a seam.
  - **F3 (check-in):** after closing the span, restore status to what the item's **latest
    movement** implies (`deployed→on_site`, `returned→returned`, …; **no movement →
    available**), reusing the `equipment_movement_derive_status` mapping. Unconditional
    re-derive (idempotent — coherent whatever the current status).
  - **Everything else byte-for-byte from `20260767000400`:** the five-role gates, the
    advisory locks, the date/exists/priced/complete/double-open guards, the exact inserts.

- **App — `checkOutEquipment` error mapping** (`src/lib/equipment/usage-actions.ts`): add a
  branch mapping the new `not on site` `P0001` → Thai ("อุปกรณ์นี้ไม่พร้อมใช้งาน
  (ซ่อม/คืน/สูญหาย)"). Backward-compatible (the message can't occur until `db:push`), so the
  app commit is safe to ship before the migration applies.

### Scope

- **IN:** the `CREATE OR REPLACE` migration (F2 + F3 on both RPCs), the one app error branch,
  pgTAP, spec/tracker. **OUT:** any new column/table/enum/grant/policy; an audit_log row (the
  usage RPCs are self-auditing append-only — the status flip is a denormalization like the
  movement trigger, no audit, consistent with the existing posture); blocking a movement that
  clobbers `in_use` (the documented overlay seam); the project-scoped item picker (a U2 seam);
  bulk/quantity; the materials F4 `stockable` guard (separate one-liner).

### Money posture

Unchanged — F2/F3 touch only `equipment_items.status` (field-visible tracking, never money)
and read no money column. `daily_rate_snapshot` stays anti-granted.

### Tests

- **pgTAP — new file `223-equipment-checkout-guards.test.sql`** (RED first, before
  `db:push`): seed items in each status + a director/site_admin/visitor + a `deployed`-movement
  item + a no-movement item. Assert: **F2** maintenance/returned/lost → `P0001`, available &
  on_site → `lives_ok`; **F3** checkout sets `status='in_use'`; **F3 restore** check-in →
  `on_site` (deployed movement) and → `available` (no movement); **gate regression**
  (project_director `lives_ok`, visitor `42501` — the re-source trap guard); **existing-guard
  regression** (unpriced → `P0001`, complete WP → `P0001`, double-open → `P0001` with the
  "already checked out" message, proving `in_use` passes the F2 status guard). UUIDs hex-only;
  `_tap_buf` grants before `set local role authenticated`; no `COMMIT`, closing `ROLLBACK`.

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green (the app branch). **pgTAP RED pre-apply**
(well-formed, fails for the right reason against the un-migrated DB). Then — **after operator
OK to push (schema gate)** — `db:push` → `db:test` green → `db:types` (no signature change, so
types are unaffected; regenerate to confirm). Operator on-device: an item in ซ่อมบำรุง can't be
checked out; checking an item out shows it กำลังใช้งาน in the registry; checking it back in
returns it to อยู่หน้างาน/พร้อมใช้งาน.

### Seams

- **Movements clobber `in_use`.** A movement recorded mid-checkout re-derives status and
  overwrites the overlay; the open usage log remains authoritative. A reconciliation (a movement
  that refuses to disturb an in_use item, or a combined status view) is a later refinement.
- **F4 (materials):** `record_stock_in` still doesn't enforce `stockable=false` — separate one-liner.
