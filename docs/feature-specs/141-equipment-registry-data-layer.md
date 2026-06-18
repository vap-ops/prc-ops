# Spec 141 — Equipment registry: categories + items (data layer, P1 U1)

**Status:** locked — 2026-06-18. **Design only / not built.** ADR 0055.
**Driver:** track all on-site equipment (owned by the sister company) as a
serialized-first asset register. This unit is the **data layer** —
`equipment_categories` + `equipment_items`, no UI. Movements/location are U3;
rental money is P2 (U4+).

## What ships (schema, operator-gated)

- **Migration** `equipment_categories`: `id uuid pk`, `name text` (non-blank
  CHECK), `parent_id uuid null` self-FK (sub-categories), `created_by` FK
  `users`, `created_at`. RLS: SELECT all staff (incl. `site_admin`,
  `procurement`); INSERT/UPDATE back office (`project_manager | procurement |
super_admin`); **NO delete** (a category an item references stays). Mirrors the
  suppliers grant matrix (ADR 0038); `created_by` pinned to `auth.uid()`.

- **Enum** `equipment_status` — `available | on_site | in_use | maintenance |
returned | lost`. Its **own migration** (enum-add isolation).

- **Enum** `equipment_tracking` — `unit | bulk`.

- **Migration** `equipment_items`:
  - `id uuid pk`
  - `category_id` FK `equipment_categories`
  - `owner_id` — FK → `equipment_owners(id)`. **Owner-host decision RESOLVED
    (2026-06-18, operator):** a DEDICATED `equipment_owners` master (not
    `suppliers`/`service_providers`), so the future owner portal can bind to it
    the way the DC portal binds to `contractors` (ADR 0051). Adds a 3rd table to
    this unit — see migration `20260723000000_create_equipment_owners.sql`.
  - `tracking equipment_tracking not null default 'unit'`
  - `name text` (non-blank CHECK)
  - `asset_tag text null` — unique when present; trimmed-non-blank CHECK
  - `quantity int null` — CHECK: `tracking='bulk' ⇒ quantity ≥ 1`;
    `tracking='unit' ⇒ quantity IS NULL`
  - `status equipment_status not null default 'available'`
  - `acquisition_cost numeric(12,2) null` — **MONEY**
  - `acquired_at date null` — owner-private metadata (treated money-adjacent)
  - `created_by` FK `users`, `created_at`
  - **Money column scope:** `acquisition_cost` and `acquired_at` get **NO
    authenticated grant** — column-scoped grants exclude them; read only via the
    admin client behind `requireRole(pm/super/procurement)`, exactly like
    `workers.day_rate`.
  - RLS: SELECT all staff (field needs to see equipment); INSERT/UPDATE back
    office (`project_manager | procurement | super_admin`); **NO delete** (asset
    history is permanent — `returned`/`lost` is a status, not a delete);
    `created_by` pinned to `auth.uid()`.
  - Grants: **column-scoped** — `authenticated` gets SELECT/INSERT/UPDATE on the
    non-money columns only; the two money columns are admin-client-only.

- **Pure helper** (`src/lib/equipment/…`): a tracking/quantity validator
  (test-first) — `unit ⇒ quantity null` and may carry an `asset_tag`;
  `bulk ⇒ quantity ≥ 1` and **no** `asset_tag`. Keep minimal — only what the
  unit needs (no UI helpers yet).

- **`database.types.ts`** hand-extended, then `db:types` reconciled against the
  live schema.

- **pgTAP** (new file): both tables + both enums exist with the right columns;
  RLS (staff SELECT, back-office INSERT/UPDATE, **no delete**, anon denied); the
  CHECK constraints (`unit ⇔ quantity null`, `bulk ⇒ quantity ≥ 1`, asset_tag
  form); the **money anti-grant** (`acquisition_cost`/`acquired_at` NOT
  selectable by `authenticated`); `created_by` pin; FK landing.

## Scope

- **IN:** the two enums, the two tables, RLS + column-scoped grants, no-delete,
  the tracking/quantity validator, pgTAP, types. The write capability for
  categories + items.
- **OUT:** all UI — list/detail = **U2**. Movements + location tracking = **U3**.
  Rental batches, allocations, frozen WP cost, owner portal = **P2 (U4–U6)**.
  Also out: bulk on-hand reconciliation, maintenance scheduling, depreciation,
  asset photos/docs.

## Money posture

`acquisition_cost` is money: zero `authenticated` grant, admin-read behind
`requireRole(pm/super/procurement)`, **never** on a site_admin screen — exactly
like `workers.day_rate` / `wp_labor_costs` (spec 68). `acquired_at` is
owner-private metadata, same exclusion. The rest of the registry (name,
category, tracking, asset_tag, status, owner) is field-visible.

## Tests

- **TDD:** `tests/unit/equipment-item.test.ts` **first** — the tracking/quantity
  validator (`unit ⇔ quantity null`; `bulk ⇒ quantity ≥ 1`; asset_tag only on
  `unit`). RED before the migration.
- pgTAP for tables/enums/RLS/grants/CHECKs/no-delete (above), written before
  `db:push`.

## Acceptance (U1)

Categories and items can be created/updated by back office and read by all staff
**except** the money columns; the bulk-vs-unit invariants are DB-enforced;
`acquisition_cost` is unreadable by an authenticated session (admin-client
only); nothing is deletable; pgTAP green; types regenerated. **No user-visible
change** — UI is U2.

## Seams

- Location/holding is **not** a column — it arrives as the append-only
  `equipment_movements` log in U3; until then items carry `status` but no place.
- The owner host-table choice (ADR 0055 open question) is settled: a dedicated
  `equipment_owners` master (`owner_id` FK target). The future owner portal
  binds `owner_users → equipment_owners`, mirroring ADR 0051's `contractors`.
- Bulk on-hand vs allocated reconciliation lands with allocations (P2), not here.

## U2 — equipment management UI (2026-06-18)

**Status:** in progress. App-only, **no migration** (U1's grants/policies carry
the writes). Makes the shipped registry visible/usable: a back-office screen to
see, add, and edit equipment + bootstrap categories and owners.

**What ships:**

- **Route** `/equipment` (server component), gated `requireRole(BACK_OFFICE_ROLES)`
  (pm/super/procurement — the U1 INSERT/UPDATE audience). Mirrors `/workers`:
  `PageShell` + `BottomTabBar` + `DetailHeader backHref="/settings"`. Fetches via
  the **RLS server client** (no admin client — U2 shows **no money**;
  `acquisition_cost`/`acquired_at` stay admin-only, untouched): `equipment_items`
  (granted cols), `equipment_categories`, `equipment_owners`.
- **`EquipmentManager`** (`src/components/features/equipment/`, `'use client'`):
  add-item form (name · category select · owner select · `tracking` RadioChip
  unit|bulk · conditional asset_tag [unit] / quantity [bulk] · status select,
  default `available`) using the U1 `validateEquipmentItem` for friendly Thai
  errors; per-item inline edit (name/category/owner/status + tracking fields);
  inline quick-add for a category (name) and an owner (name + phone) so the
  registry can be bootstrapped. No `acquisition_cost` field. No optimistic toggle
  (status is an explicit edit, not a binary flip).
- **Actions** (`src/app/equipment/actions.ts`, `'use server'`): `createEquipment`,
  `updateEquipment`, `createEquipmentCategory`, `createEquipmentOwner` — each
  `requireRole(BACK_OFFICE_ROLES)` (defense-in-depth over RLS), validates shape
  (`validateEquipmentItem` + UUID/enum checks), writes via the RLS client with
  `created_by = ctx.id` (satisfies the U1 created_by-pin policy), decide-pattern
  `{ok}|{ok,error}` returns, `revalidatePath("/equipment")`. **No RPC** — U1's
  column-scoped grants + back-office policies + DB CHECKs are the guard.
- **Nav:** a `SettingsLink` row (อุปกรณ์) in the settings master-data section
  (pm/super) + `/equipment` added to `SETTINGS_TAB.match`.

**Scope — IN:** the page, the manager, the 4 actions, the nav entry, a component
test. **OUT:** money (acquisition_cost entry/display — admin-only, later);
movements/deployment (U3); site_admin read-only view + its nav (deferred until
U3 gives the field a reason); category/owner edit + delete (no-delete by design);
detail page (the manager is list+inline-edit, like the worker roster).

**Tests:** `tests/unit/equipment-manager.test.tsx` (component, mocked actions):
row render, add unit item → `createEquipment` shape, bulk switch shows quantity +
passes it, inline edit → `updateEquipment`, quick-add category/owner → their
actions. `validateEquipmentItem` already unit-tested (U1). Server actions =
verified-by-checklist (auth-gated; RLS + CHECKs carry correctness; the component
test covers the wiring through mocked actions).

**Verified-by-checklist** (auth-gated page → no preview; the component test +
the U1 validator/pgTAP carry correctness; operator on-device pass = acceptance).

## U3 — equipment movements + current location (2026-06-18)

**Status:** in progress. **Schema** (change-management gate). The append-only
custody log that makes equipment actually move onto sites, and the foundation
P2's daily usage logging builds on. **Data layer only** — the move-equipment UI

- current-location display is U4.

**What ships:**

- **Migration** `20260724000000_create_equipment_movements.sql`:
  - `equipment_movement_kind` enum: `received` (from owner into the PRC pool) ·
    `deployed` (to a project) · `returned` (to owner) · `maintenance` · `lost`.
  - `equipment_movements` (id, item_id→equipment_items, kind, project_id→projects
    [null], quantity≥1, occurred_at, note, created_by, created_at). **CHECK:**
    `project_id is not null` ⇔ `kind = 'deployed'` (a set deploys to a project;
    every other kind has no project). **Append-only:** SELECT + INSERT grants
    only, NO update/delete grant or policy — a correction is a compensating
    movement, never a row edit.
  - RLS: staff SELECT + INSERT (`site_admin/pm/super/procurement` — the field
    physically moves gear, so site_admin records movements; this is **tracking,
    not money**), `created_by` pinned to the caller.
  - **SECURITY DEFINER AFTER INSERT trigger** `equipment_movement_derive_status`
    denormalizes `equipment_items.status` from the new movement
    (received→available, deployed→on_site, returned→returned,
    maintenance→maintenance, lost→lost). Definer because a site_admin records
    movements but can't UPDATE equipment_items under RLS — same posture as the
    purchasing derive triggers.
- **Pure helper** `src/lib/equipment/current-location.ts`
  `currentEquipmentLocation(movements)` → latest movement per item (by
  `occurred_at`) → `{ kind, projectId }`; the display source of truth for
  where-with-which-project (5 unit tests, TDD).
- **pgTAP file 66**: catalog + enum, the kind↔project CHECK, quantity≥1,
  append-only (no update/delete → 42501), staff INSERT + created_by pin, visitor
  denied, the status-derive trigger (deployed→on_site, returned→returned), anon
  denied.
- **`database.types.ts`** reconciled at the gate (`db:types`).

**Scope — IN:** the enum, the table, RLS + append-only grants, the CHECK + qty
guard, the status-derive trigger, the location helper, pgTAP. **OUT:** the
move-equipment UI + current-location/where-is-it display (U4); bulk
partial-quantity-across-projects reconciliation (latest-event only here; the
allocation/P2 concern, U1 seam); audit_log rows (the append-only log is itself
the trail); `in_use` status (manual refinement, never auto-derived).

**Money posture:** unchanged — movements carry no money; fully field-visible.

**Tests:** `tests/unit/equipment-location.test.ts` (5, TDD first) + pgTAP file 66
(post-push). Server-write path = direct grants + CHECKs + the trigger (no app
action this unit; the move UI's action arrives in U4).

**Verified-by-checklist** (no UI this unit; the helper carries TS correctness,
pgTAP carries DB correctness post-push).

**Seams:** the status-derive trigger is last-recorded-wins (a backdated movement
would set status to its own kind); `currentEquipmentLocation` is latest-OCCURRED
and is the display source of truth — they agree when movements are recorded
chronologically. Bulk current-on-project quantity (signed-sum across deploy/
return) lands with allocations (P2), not here.

## U4 — move equipment + where-is-it display (2026-06-18)

**Status:** in progress. App-only, **no migration** (U3's `equipment_movements`
grants/policies + the status-derive trigger + the `currentEquipmentLocation`
helper carry the write and the derivation). The payoff unit: U1–U3 built the
spine (registry, management UI, append-only custody log) but **nothing yet moves
gear onto a site or shows where a piece is**. U4 adds the deploy/return action
and the current-location badge to the existing back-office `/equipment` screen.

**Audience:** the existing `/equipment` page stays gated to
`BACK_OFFICE_ROLES` (pm/super/procurement). Back office records movements from
the office. The `site_admin` **field-facing** move view (RLS already permits
site_admin INSERTs — U3) is still deferred to a later unit; U4 does **not** add a
field view or widen the page gate.

**What ships:**

- **SSOT labels** — `EQUIPMENT_MOVEMENT_KIND_LABELS: Record<EquipmentMovementKind,
string>` in `src/lib/i18n/labels.ts` (the move-form kind picker + the
  where-is-it badge both render kinds → single-source per the term-consistency
  rule): `received`→"รับเข้าคลัง", `deployed`→"หน้างาน", `returned`→"คืนเจ้าของ",
  `maintenance`→"ซ่อมบำรุง", `lost`→"สูญหาย".
- **Pure helper** `src/lib/equipment/equipment-location-label.ts`
  `equipmentLocationLabel(location: EquipmentLocation | undefined, projectName:
string | null): string` — composes the SSOT kind label with the project name
  for `deployed` (`"หน้างาน: <project>"`, or just "หน้างาน" if the name is
  missing) and returns a placeholder (`"—"` / "ยังไม่มีการเคลื่อนย้าย") when the
  item has no movements. **TDD first** (≥5 cases: each non-deployed kind,
  deployed-with-name, deployed-missing-name, undefined→placeholder).
- **Action** `recordEquipmentMovement` (`src/app/equipment/actions.ts`,
  `'use server'`): `requireRole(BACK_OFFICE_ROLES)` (defense-in-depth over the
  U3 RLS), validates `itemId` UUID, `kind` ∈ the 5 kinds, the **project-IFF-
  deployed** invariant (`deployed` ⇒ a valid project UUID; every other kind ⇒
  project null — mirrors the DB CHECK so the UI fails friendly before the
  insert), `quantity ≥ 1` (default 1), `note` ≤ 2000. Inserts into
  `equipment_movements` via the **RLS server client** with `created_by = ctx.id`
  (satisfies the U3 created_by pin); `occurred_at` omitted → DB `now()`.
  decide-pattern `{ok}|{ok,error}`, `revalidatePath("/equipment")`. **No RPC** —
  U3's grants + the project-IFF CHECK + the qty CHECK + the derive trigger are
  the guard.
- **Page** (`/equipment`): two added fetches via the RLS client —
  `equipment_movements` (`item_id, kind, project_id, occurred_at`) and `projects`
  (`id, name`). Both passed into `EquipmentManager`.
- **`EquipmentManager`** (extend): new props `projects` + `movements`. Builds the
  location map with the U3 `currentEquipmentLocation` and renders a **where-is-it
  badge** per row via `equipmentLocationLabel` (resolving project name from
  `projects`). Per row a **"ย้าย" (move) control** opens an inline form: kind
  select (5 kinds), project select **shown only when kind=deployed** (and
  required there), quantity input **shown only when the item is `bulk`** (default
  1), optional note → submit calls `recordEquipmentMovement`. Reuses the existing
  field primitives (Select/RadioChip pattern already in the manager). No
  optimistic update (a movement is an explicit log, and the status derive happens
  server-side).

**Scope — IN:** the SSOT kind labels, the location-label helper (TDD), the
`recordEquipmentMovement` action, the page's two fetches, the move form +
where-is-it badge in `EquipmentManager`, tests. **OUT:** `site_admin` field move
view + its nav + the widened gate (next unit); bulk partial-quantity-across-
projects reconciliation (latest-event only — the allocation/P2 concern);
backdating UI (`occurred_at` = now only); editing/voiding a movement (append-only
— a correction is a new compensating movement, no UI affordance this unit);
`in_use` status (manual refinement, never auto-derived); money; audit_log rows
(the log is its own trail).

**Tests:**

- `tests/unit/equipment-location-label.test.ts` (pure helper) — **TDD first,
  RED** before the helper exists.
- `tests/unit/equipment-manager.test.tsx` (extend, component, mocked actions):
  the where-is-it badge renders from `movements`; opening the move form on a row;
  kind=deployed reveals + requires the project select; a non-deployed kind hides
  the project select; submit → `recordEquipmentMovement` correct shape; a `bulk`
  item shows the quantity input.
- `recordEquipmentMovement` = **verified-by-checklist** (auth-gated; the U3 RLS +
  CHECKs + derive trigger carry DB correctness, already covered by pgTAP file 66;
  the component test covers the wiring through the mocked action).

**Verification:** `pnpm lint && pnpm typecheck && pnpm test` green. Auth-gated
page → no preview; operator on-device pass = acceptance.

**Seams:** U4 records the **latest event** only — a bulk item split across two
projects shows its most recent deploy, not a per-project on-hand tally (that is
the P2 allocation concern, U1 seam). The badge reads `currentEquipmentLocation`
(latest-OCCURRED) while the row's status chip reads the trigger-derived
`equipment_items.status` (last-RECORDED) — they agree for chronological entry,
the documented U3 seam.
