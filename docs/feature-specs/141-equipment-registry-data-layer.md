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
