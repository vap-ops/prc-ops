# Spec 146 — Equipment rental money (P2; ADR 0055 decision 5)

**Status:** locked — 2026-06-19. **Design only / not built.** ADR 0055.
**Driver:** P1 (spec 141, U1–U5) shipped pure equipment _tracking_ — registry,
management UI, append-only movement custody, where-is-it display — with **zero
money**. P2 layers the rental economics ADR 0055 designed for: PRC rents sets
from the sister company **monthly** (PRC's cost), charges WPs a **daily**
per-item rate (PRC's revenue), freezes a per-WP equipment cost into the
budget-vs-spend, and exposes the owner its ROI. Money posture is the
`wp_labor_costs` posture (spec 68) copied exactly: **zero authenticated grant,
admin-read behind `requireRole(pm/super/procurement)`, never on a
site_admin-reachable screen, every write audited.**

This spec opens with the **first P2 unit fully scoped** (the money spine — the
~10hr build that comes next) and a **P2 roadmap** (U1–U6) so the operator sees
where it goes. Per the feature workflow, **build U1 only, then stop.**

---

## P2 roadmap (units, dependency-ordered)

| Unit   | Ships                                                                                                                                                                                                                         | Depends on                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **U1** | **Money spine** — `equipment_items.daily_rate` (ALTER, money) + `equipment_rental_batches` (inbound monthly cost) + the two money-write RPCs + 2 audit-action values + validators + pgTAP. **No UI. The unit specced below.** | spec 141 P1                |
| U2     | `equipment_project_allocations` — a rental batch's set attached to a project for a period (decision 4/8); the membership that ties a monthly batch cost to where it's committed. Data layer.                                  | U1                         |
| U3     | `equipment_usage_logs` — per-item, per-WP, per-day usage at a `daily_rate_snapshot` (mirror `labor_logs`); the outbound charge basis (decision 5). Data layer + usage-entry seam.                                             | U1 (rate), U2 (allocation) |
| U4     | `wp_equipment_costs` + `freeze_wp_equipment_cost(p_wp)` (mirror `wp_labor_costs` + `freeze_wp_labor_cost` exactly); the frozen per-WP snapshot.                                                                               | U3                         |
| U5     | Budget-vs-spend integration (spec 100) — equipment joins labor + materials in the WP cost view; back-office rate/batch/usage UI on `/equipment` + the WP detail.                                                              | U4                         |
| U6     | Owner portal (reuse ADR 0051 on the `owner_id` axis) — the sister company logs in scoped, sees its own register, deployment, utilization, and rental income only.                                                             | U1–U5                      |

The batch-payment mechanism (real cash PRC→sister co vs intercompany book entry;
ties to spec 127/128/129) and the owner-access identity mechanism stay **open
questions in ADR 0055** — confirmed before U6, not now.

---

## U1 — money spine: per-item daily rate + inbound rental batches (2026-06-19)

**Status:** designed — not built. **Schema** (change-management gate). The
foundational P2 unit: the two money _inputs_ PRC controls — the **daily rate it
charges out per item** and the **monthly cost it pays per rented set** — with the
labor money posture copied bit-for-bit. No allocation, no usage, no freeze, no UI
(those are U2–U5). Zero field exposure; zero site_admin reachability.

### What ships

- **Migration — ALTER `equipment_items` add `daily_rate numeric(12,2) null`.**
  **MONEY** (ADR 0055 decision 5/6): the per-item charge-out rate PRC sets,
  independent of the batch cost (Case A). `null` = not yet priced. CHECK
  `daily_rate is null or daily_rate >= 0`. **Anti-grant:** the existing
  column-scoped `authenticated` grants on `equipment_items` (spec 141) enumerate
  the non-money columns and are **not** widened — a new column receives no
  column grant by default, so `daily_rate` is admin-client-only out of the box,
  exactly like `acquisition_cost`/`acquired_at`. (Stated + pgTAP-asserted, not
  assumed.) `comment on column` documents the money posture.

- **Migration — audit-action enum values, own migration (enum-add isolation).**
  `alter type public.audit_action add value 'equipment_rate_change';` and
  `'equipment_batch_create';` — mirrors `worker_change` (20260619000100) and
  `labor_cost_freeze` (20260623000000), each in its own migration. **Grep every
  `audit_action` enum pin in pgTAP and update** (spec 27 lesson: a missed pin
  fails the suite).

- **Migration — `equipment_rental_batches`** (the inbound deal header — PRC's
  fixed monthly cost; decision 5). One row per rented set from an owner for a
  period at a monthly rate. Batch↔items _membership_ is **U2's allocation
  concern** — U1 is the header only.
  - `id uuid pk default gen_random_uuid()`
  - `owner_id uuid not null` FK → `equipment_owners(id)`
  - `monthly_rate numeric(12,2) not null` — **MONEY**; CHECK `>= 0`
  - `starts_on date not null`
  - `ends_on date null` — open-ended until the set is returned; CHECK
    `ends_on is null or ends_on >= starts_on`
  - `note text null`
  - `created_by uuid not null` FK → `users(id)`, pinned to `auth.uid()` by the RPC
  - `created_at timestamptz not null default now()`
  - **Money table = zero grant** (the `wp_labor_costs` posture): `enable row
level security` then `revoke all … from anon, authenticated`. With no
    authenticated grant there is no read/write policy to add (RLS stays enabled
    per the project rule); the table is written **only** by the SECURITY DEFINER
    RPC below and read **only** via the admin client behind
    `requireRole(pm/super/procurement)`. **No delete** (a rental record is
    permanent history; an ended batch carries `ends_on`, it is not removed).
  - `comment on table` / `comment on column monthly_rate` document the posture.

- **RPC — `set_equipment_daily_rate(p_id uuid, p_rate numeric)`** returns void,
  `security definer`, `set search_path = public`. **Mirrors
  `set_worker_day_rate`** (the column UPDATE grant is deliberately _not_ widened —
  spec 31-amendment lesson: a column-write RPC, never a broad table grant, for a
  money column):
  - Gate: `current_user_role() not in ('project_manager','super_admin',
'procurement')` → raise `42501`. **Audience note:** procurement IS in the
    equipment money audience (the equipment back office = `BACK_OFFICE_ROLES`,
    ADR 0055 decision 6 names pm/super/procurement) — a deliberate **divergence
    from `set_worker_day_rate`** (pm/super only; procurement is not a labor
    actor). Flagged here so review doesn't read it as a copy slip.
  - Validate `p_rate is null or p_rate < 0` → `P0001` (reject null + negative,
    like the labor precedent — a rate _set_ is a non-negative number; clearing a
    rate is not a U1 use case).
  - Existence: `select daily_rate into v_old from equipment_items where id =
p_id`; `not found` → `P0001`. (SECURITY DEFINER bypasses RLS; existence is
    the guard.)
  - `update equipment_items set daily_rate = p_rate where id = p_id;`
  - `audit_log` row: action `equipment_rate_change`, `target_table
'equipment_items'`, `target_id p_id`, payload `{kind:'rate_change',
old_rate, new_rate}` — mirrors the `worker_change` rate payload.
  - `revoke all on function … from public; grant execute … to authenticated;`
    (tighten so anon can't reach it; authenticated still hits the internal gate).

- **RPC — `create_equipment_rental_batch(p_owner_id uuid, p_monthly_rate
numeric, p_starts_on date, p_ends_on date default null, p_note text default
null)`** returns `uuid` (the new batch id, so a future UI can chain),
  `security definer`, `set search_path = public`:
  - Same pm/super/procurement gate → `42501`.
  - Validate: owner exists (`perform 1 from equipment_owners where id =
p_owner_id`; else `P0001`); `p_monthly_rate is null or < 0` → `P0001`;
    `p_ends_on is not null and p_ends_on < p_starts_on` → `P0001`. (The CHECKs
    are the real guard; the RPC fails friendly _before_ the insert.)
  - `insert … (owner_id, monthly_rate, starts_on, ends_on, note, created_by)
values (…, auth.uid()) returning id` (satisfies the `created_by` pin on a
    zero-grant table — only the definer writes it).
  - `audit_log` row: action `equipment_batch_create`, `target_table
'equipment_rental_batches'`, `target_id <new id>`, payload `{owner_id,
monthly_rate, starts_on, ends_on}`.
  - Same `revoke from public` / `grant to authenticated` tightening.

- **Pure validators** (`src/lib/equipment/`, **TDD first**):
  - `validateEquipmentDailyRate(rate: number | null | undefined)` → decide-shape
    `{ ok: true } | { ok: false; error: string }` (friendly Thai): finite,
    `>= 0`. The UI gate before `set_equipment_daily_rate`.
  - `validateRentalBatch({ monthlyRate, startsOn, endsOn })` → same shape:
    `monthlyRate >= 0` finite; `endsOn` (when present) `>= startsOn`. Mirrors the
    DB CHECKs so the form fails friendly. Dates compared as ISO `YYYY-MM-DD`
    strings (lexicographic = chronological), no `Date` parsing.

- **`database.types.ts`** hand-extended (the new column, the table, the two RPC
  signatures, the two enum values), then `db:types` reconciled against the live
  schema at the gate.

### Scope

- **IN:** the `daily_rate` ALTER + CHECK + anti-grant; the two audit-action enum
  values (own migration); the `equipment_rental_batches` table + RLS + zero-grant
  - CHECKs + no-delete; the two money-write RPCs; the two pure validators
    (test-first); pgTAP (new file 77); types.
- **OUT:** allocations (U2); usage logs (U3); the freeze RPC + `wp_equipment_costs`
  (U4); budget-vs-spend join + any UI/rate-entry/batch-entry screen (U5); owner
  portal (U6). Also out: clearing a daily rate to null; multi-currency; batch
  amendment/supersede (a corrected batch is a new batch + ended old one, a U2+
  concern); depreciation/maintenance accounting (ADR 0055, PEAK territory).

### Money posture

`equipment_items.daily_rate`, `equipment_rental_batches.monthly_rate` — **zero
authenticated grant**, admin-read only behind `requireRole(pm/super/procurement)`,
**never** on any site_admin-reachable screen (spec 46), every write audited.
Identical to `workers.day_rate` / `wp_labor_costs`. Tracking data (the registry
minus cost, movements, categories, location, status) stays field-visible —
unchanged from P1.

### Tests

- **TDD (RED first):** `tests/unit/equipment-daily-rate.test.ts` and
  `tests/unit/rental-batch.test.ts` — the two validators, before any migration or
  helper exists. State **"Writing failing test first."**
- **pgTAP — new file `77-equipment-rental-money.test.sql`** (written before
  `db:push`): `daily_rate` column exists + type + CHECK; the **anti-grant**
  (`authenticated` has NO SELECT on `daily_rate` — `has_column_privilege` false —
  alongside `acquisition_cost`); `equipment_rental_batches` exists with the right
  columns + CHECKs (`monthly_rate >= 0`, `ends_on >= starts_on`); RLS enabled;
  **zero authenticated grant** on the table; **no delete** (no DELETE
  privilege/policy); the two enum values present (`enum_has_labels` /
  per-value); the RPC role gates (visitor + **site_admin** → `42501`; a pm sets a
  rate and creates a batch; `created_by` pinned to the caller; an `audit_log` row
  with the right action written by each RPC); anon denied. Update **every**
  `audit_action` enum-label pin in the suite (grep first).

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:push` then
`pnpm db:test` green; `pnpm db:types` regenerated. **No user-visible change** (no
UI this unit). The validators + pgTAP carry correctness; the RPC writes are
**verified-by-checklist** (auth-gated, DB-CHECK-guarded, pgTAP-covered). Operator
on-device pass is not required (nothing renders).

### Seams

- The batch is the **header only** — _which items_ are in a rented set is U2's
  `equipment_project_allocations`. A monthly batch cost has no committed
  deployment until U2; U1 records the deal, not its placement.
- `daily_rate` is a **current** rate on the item (mutable via RPC, audited); the
  immutable per-charge value is U3's `equipment_usage_logs.daily_rate_snapshot`
  (taken at usage time) — the `workers.day_rate` → `labor_logs.day_rate_snapshot`
  split, copied.
- Procurement is in the **write** gate here (equipment back office) but is not in
  the labor freeze gate — the divergence is deliberate and flagged in the RPC
  spec above so it survives review.
- `wp_equipment_costs` + `freeze_wp_equipment_cost` mirror
  `wp_labor_costs`/`freeze_wp_labor_cost` **exactly** when they land in U4 (same
  UPSERT, same old/new audit payload, same pm/super/procurement gate, same
  `not exists` current-rows aggregation) — pre-noted so U4 is a copy, not a
  redesign.

## U2 — project allocation: commit a rental batch to a project (2026-06-19)

**Status:** designed — not built. **Schema** (change-management gate). The
second P2 unit: record **where the monthly batch cost is committed** — a rented
set (an `equipment_rental_batches` row) attached to a **project** for a period
(ADR 0055 decisions 4/8). Data layer, no UI, money domain. Mirrors U1's posture
and shape bit-for-bit (zero-grant money table + a single SECURITY DEFINER
create RPC + one audit-action value + a period validator + pgTAP).

**Model clarification (resolves the U1 §Seams wording).** An allocation is the
**money commitment** of a batch to a project — _not_ a list of which items are in
the set. Two axes already exist and stay separate:

- **Physical custody** = `equipment_movements` (spec 141 U3): item X is
  `deployed` to project Y, **field-visible**. Where the gear physically is.
- **Money commitment** = `equipment_project_allocations` (this unit): batch B's
  monthly cost is committed to project Y for period P, **admin-only**. Where the
  rental cost lands.

Under Case A (independent per-item daily charge-out, **not** a pass-through split
of the batch's monthly cost), the batch monthly cost is a project-level
commitment, so the allocation needs **no** per-item membership or quantity. Which
items belong to a batch is **not modeled** and is **not needed** for the cost
model — recorded as a seam if it's ever wanted.

### What ships

- **Migration — audit-action enum value, own migration (enum-add isolation):**
  `alter type public.audit_action add value if not exists
'equipment_allocation_create';`. **Update BOTH `enum_has_labels` pins** (pgTAP
  file 03 AND file 18) — the U1 lesson, re-applied without being re-taught.

- **Migration — `equipment_project_allocations`:**
  - `id uuid pk default gen_random_uuid()`
  - `batch_id uuid not null` FK → `equipment_rental_batches(id)`
  - `project_id uuid not null` FK → `projects(id)`
  - `starts_on date not null`
  - `ends_on date null` — open-ended until the set is pulled back; CHECK
    `ends_on is null or ends_on >= starts_on`
  - `note text null`
  - `created_by uuid not null` FK → `users(id)`, pinned to `auth.uid()` by the RPC
  - `created_at timestamptz not null default now()`
  - index on `(project_id)` and on `(batch_id)`
  - **Money table = zero grant** (the U1 `equipment_rental_batches` posture):
    `enable row level security` then `revoke all … from anon, authenticated`. No
    authenticated grant ⇒ no policy to add (RLS stays enabled per the project
    rule). Written **only** by the RPC below; read **only** via the admin client
    behind `requireRole(pm/super/procurement)`. **No delete** (a commitment is
    permanent history; an ended allocation carries `ends_on`).
  - `comment on table` documents the posture + the physical-vs-money split.

- **RPC — `create_equipment_project_allocation(p_batch_id uuid, p_project_id
uuid, p_starts_on date, p_ends_on date default null, p_note text default
null)`** returns `uuid`, `security definer`, `set search_path = public`.
  Mirrors `create_equipment_rental_batch`:
  - Gate `current_user_role() not in ('project_manager','super_admin',
'procurement')` → `42501` (same equipment back-office audience as U1).
  - Validate: batch exists (`perform 1 from equipment_rental_batches`; else
    `P0001`); project exists (`perform 1 from projects`; else `P0001`);
    `p_starts_on is null` → `P0001`; `p_ends_on is not null and p_ends_on <
p_starts_on` → `P0001`.
  - `insert … (batch_id, project_id, starts_on, ends_on, note, created_by)
values (…, auth.uid()) returning id`.
  - `audit_log` row: action `equipment_allocation_create`, `target_table
'equipment_project_allocations'`, `target_id <new id>`, payload
    `{batch_id, project_id, starts_on, ends_on}`.
  - `revoke all on function … from public; grant execute … to authenticated;`.

- **Pure validator** (`src/lib/equipment/validate-allocation.ts`, **TDD first**):
  `validateAllocation({ startsOn, endsOn })` → `{ ok: true; value } | { ok:
false; error }` (Thai): `startsOn` required + ISO `YYYY-MM-DD`; `endsOn`
  optional (blank → null) + ISO + `>= startsOn`. The date logic mirrors
  `validateRentalBatch`'s (lexicographic ISO compare, no `Date` parsing); kept a
  **separate** module (no shared-helper extraction this unit — scope discipline;
  a dedup is a recorded cleanup seam).

- **`database.types.ts`** reconciled (`db:types`, dual-writes app + worker).

### Scope

- **IN:** the audit-action value (both pins), the
  `equipment_project_allocations` table + RLS + zero-grant + CHECK + no-delete +
  indexes, the `create_equipment_project_allocation` RPC, the `validateAllocation`
  validator (test-first), pgTAP (new file 78), types.
- **OUT:** per-item/bulk-quantity allocation arithmetic (the documented
  bulk-reconciliation seam — Case A doesn't need it); batch-item membership
  (not modeled, not needed); ending/superseding an allocation (append-style —
  set `ends_on` via a future edit RPC, not this unit); usage logs (U3); freeze +
  `wp_equipment_costs` (U4); any UI (U5); owner portal (U6). No money column on
  the allocation itself (the cost is the batch's `monthly_rate`).

### Money posture

The allocation links a project to a money batch, so it is **money domain**: zero
authenticated grant, admin-read behind `requireRole(pm/super/procurement)`, never
on a site_admin screen, written only via the audited RPC. Physical deployment for
the field stays on `equipment_movements` (field-visible) — unchanged.

### Tests

- **TDD (RED first):** `tests/unit/allocation.test.ts` — `validateAllocation`
  (required/ISO start, optional end, end-before-start rejected, blank end → null),
  before the migration/helper. State **"Writing failing test first."**
- **pgTAP — new file `78-equipment-project-allocations.test.sql`:** catalog / PK
  / RLS / zero-policy; the period CHECK; zero authenticated grant; no delete; the
  enum value present; the RPC gate (site_admin AND visitor → `42501`; procurement
  ALLOWED; pm happy path); `P0001` for a bad batch, a bad project, and
  end-before-start; `created_by` pin; exactly one `equipment_allocation_create`
  audit row; anon denied. Update both `audit_action` enum pins.

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:push` then
`pnpm db:test` green; `pnpm db:types` regenerated. **No user-visible change.**
RPC write = **verified-by-checklist** (auth-gated, CHECK-guarded, pgTAP-covered).

### Seams

- Whole-batch-to-project only — a rented set split across two projects, or a
  per-item/bulk-quantity allocation, is the deferred reconciliation seam (Case A
  doesn't require it; revisit if a batch is ever physically split).
- Ending an allocation (setting `ends_on`) needs a small edit RPC — not built
  here (allocations are create-only this unit; `ends_on` is set at creation when
  the window is known).
- The `validateAllocation` date logic duplicates `validateRentalBatch`'s ISO
  helpers — a shared `src/lib/equipment/iso-date.ts` extraction is a recorded
  cleanup seam (kept separate now per scope discipline).

## U3 — equipment usage logs: check-out / check-in → per-WP charge → `wp_profit` (2026-06-20)

**Status:** designed — building. **Schema** (change-management gate). The third P2
unit: attribute equipment to a **work package** via a **check-out / check-in usage
log**, derive a **per-WP equipment charge**, and **wire it into `wp_profit`**
(spec 161 U3b) so the WP profit number stops understating equipment.

**Why this revises the roadmap-table U3/U4 sketch.** The roadmap above sketched U3
as a per-item/per-**day** log (mirror `labor_logs` row-per-day) and U4 as a frozen
`wp_equipment_costs` snapshot. The operator chose a different shape on 2026-06-20:

1. **Granularity = check-out / check-in SPAN, not row-per-day.** An item sits on a
   WP across a span (out 06-01, in 06-10). One usage row per checkout; billed =
   whole days on site × the item's daily rate. (Operator pick, this session.)
2. **The WP is charged the CHARGE-OUT daily rate, computed LIVE.** Symmetric with
   DC labor @ SELL: the WP profit center pays the per-item rental fee PRC sets; PRC
   keeps the margin over the monthly batch cost (Case A; ADR 0060 §2 "equipment
   rental" term). This is the **transfer-price layer** — a number the GL does **not**
   hold (the GL holds the batch **cost** at batch grain, intercompany AP). So
   `wp_equipment_sell(p_wp)` computes it **live from the usage logs**, exactly as
   `wp_labor_sell` computes labor @ SELL live from `labor_logs` (NOT a "second
   costing path" — a different number than the GL's, like labor). **No new GL
   account / posting** this unit (that, plus the frozen snapshot, stays a later
   seam). (Operator pick, this session.)

The old U4 (`wp_equipment_costs` + `freeze_wp_equipment_cost`) is **deferred** — it
belongs to budget-vs-spend / GL posting, not to wiring the live `wp_profit`. The
live read is what `wp_profit` needs (it reuses the live `wp_labor_sell`, never the
frozen `wp_labor_costs`).

### What ships

- **Migration — `equipment_usage_logs`** (the per-WP charge basis). Append-only,
  supersede pattern (ADR 0004/0009), mirroring `labor_logs`:
  - `id uuid pk default gen_random_uuid()`
  - `item_id uuid not null` FK → `equipment_items(id)`
  - `work_package_id uuid not null` FK → `work_packages(id)` — **WP grain** (the
    point: movements are project-grain, this is the billing attribution)
  - `checked_out_on date not null`
  - `checked_in_on date null` — `null` = still out (open checkout)
  - `daily_rate_snapshot numeric(12,2) not null` — **MONEY**; the item's
    `daily_rate` captured at checkout so a later rate change never rewrites history
    (the `workers.day_rate` → `labor_logs.day_rate_snapshot` split)
  - `entered_by uuid not null` FK → `users(id)`, pinned to `auth.uid()` by the RPC
  - `superseded_by uuid null` self-FK → `equipment_usage_logs(id)` — the supersede
    chain (a check-in's closed row supersedes the open row; future corrections too)
  - `correction_reason text null` — optional (a plain check-in carries none; a
    future correction RPC sets it). **No `reason iff superseded` CHECK** — unlike
    `labor_logs`, the FIRST supersede here is the normal check-in, not a correction.
  - `created_at timestamptz not null default now()`
  - CHECK `checked_in_on is null or checked_in_on >= checked_out_on`
  - indexes on `(work_package_id)`, `(item_id, checked_out_on)`, `(superseded_by)`
  - **Money posture (column-scoped, the `labor_logs` shape):** `enable row level
security`; `revoke all from anon, authenticated`; then a **column-scoped SELECT
    grant on every column EXCEPT `daily_rate_snapshot`** to `authenticated`
    (admin-client-only money column, like `labor_logs.day_rate_snapshot`). **No
    insert/update/delete grant** — the RPCs are the only write path. One SELECT
    policy: readable by `site_admin / project_manager / procurement / super_admin`
    (the equipment field+back-office audience).
  - **Append-only third layer:** a `BEFORE UPDATE/DELETE/TRUNCATE` trigger raising
    `P0001` (`labor_logs_block_mutation` shape) — a correction is a new superseding
    row, never a mutation.
  - `comment on table` / `comment on column daily_rate_snapshot` document posture.

- **RPC — `check_out_equipment(p_item uuid, p_wp uuid, p_date date)`** returns
  `uuid`, `security definer`, `set search_path = public`. Mirrors `log_labor_day`:
  - Gate `current_user_role() not in ('site_admin','project_manager',
'procurement','super_admin')` → `42501` (the equipment field+back-office
    audience; procurement included, like the U1/U2 money RPCs and movements).
  - `p_date is null` → `P0001`.
  - **Per-item advisory xact lock** (`pg_advisory_xact_lock` on the item) so the
    open-checkout uniqueness check below is race-free (the `log_labor_day` lock).
  - Item exists (`select daily_rate …`; not found → `P0001`). Item **must be
    priced**: `daily_rate is null` → `P0001` (can't bill an unpriced item).
  - WP exists (`select status …`; not found → `P0001`); WP not `complete` →
    `P0001` (the `log_labor_day` complete guard; a closed WP takes no new charges).
  - **One open checkout per item:** reject if a CURRENT (non-superseded) row exists
    for `p_item` with `checked_in_on is null` → `P0001` (an item can't be in two
    WPs at once).
  - Insert the open row (`checked_in_on` null, `daily_rate_snapshot` = the item's
    `daily_rate`, `entered_by` = `auth.uid()`); `returning id`.

- **RPC — `check_in_equipment(p_log uuid, p_date date)`** returns `uuid`,
  `security definer`:
  - Same field+back-office gate → `42501`. `p_date is null` → `P0001`.
  - Load the row (`p_log`); not found → `P0001`. Must be **current** (not already
    superseded → `P0001`) and **open** (`checked_in_on is null` → else `P0001`).
  - `p_date < checked_out_on` → `P0001`.
  - Per-item advisory lock; insert a **closed successor** row (same item / WP /
    `checked_out_on` / `daily_rate_snapshot`, `checked_in_on = p_date`,
    `superseded_by = p_log`, `correction_reason` null) → supersedes the open row;
    `returning id`. (Append-only: the open row is never UPDATEd.)

- **RPC — `wp_equipment_sell(p_wp uuid)`** returns `numeric`, `security definer`,
  `stable`. **Mirrors `wp_labor_sell`** — the live per-WP equipment charge:
  - Gate: `super_admin` + `project_director` only, null-safe `is distinct from`
    (the economics posture; NO `project_manager` ref → ADR 0058 pgTAP 90/91
    untouched). WP exists else `P0001`.
  - Σ over **CURRENT** (non-superseded) usage rows for the WP of
    `billable_days × daily_rate_snapshot`, where
    `billable_days = greatest((coalesce(checked_in_on, current_date) -
checked_out_on) + 1, 0)` — **whole days inclusive** (same-day = 1; an **open**
    checkout accrues to `current_date`). `coalesce(…, 0)`. No internal/external
    branch (equipment has one charge-out rate, unlike level-graded labor).
  - `revoke from public; grant execute to authenticated` (the read-money posture).

- **Migration — `wp_profit` REPLACE.** `create or replace function wp_profit` with
  the **same return signature**; body sets `v_equipment := public.wp_equipment_sell
(p_wp)` (definer-to-definer, the caller's super/director role still resolves) and
  `v_eq_costed := true`. `profit = budget − labor_sell − materials − equipment`
  unchanged. The flagged-gap comment is replaced with the live-charge note. Grants
  persist across `create or replace`.

- **`database.types.ts`** (app + worker) regenerated (`db:types`): the new table,
  the three RPC signatures.

### Scope

- **IN:** `equipment_usage_logs` (+ column-scoped grant, RLS, append-only trigger,
  CHECK, indexes); `check_out_equipment` + `check_in_equipment`; `wp_equipment_sell`;
  the `wp_profit` replace; pgTAP (new file **105**); the `102-wp-profit` update
  (`equipment_costed` true; a with-equipment case in 104); types.
- **OUT:** any UI / rate-entry / checkout screen (a later unit); a **correction /
  cancel** RPC (`correct_equipment_usage` — a recorded seam; check-in already closes
  an open checkout, and the supersede column is in place for it); the frozen
  `wp_equipment_costs` + `freeze_wp_equipment_cost` snapshot (deferred — budget-vs-
  spend / GL posting territory, not the live `wp_profit` path); a WP-dimensioned
  equipment GL posting (a later spec touching the poster / ADR 0055/0057);
  half-day / hourly proration (whole-day count, operator pick); bulk-quantity
  checkout (one item per checkout; bulk-split is the documented seam); audit_log
  rows (the append-only log IS the trail, like `labor_logs` / movements — no
  enum-add).

### Money posture

`equipment_usage_logs.daily_rate_snapshot` — **zero authenticated grant** (omitted
from the column-scoped SELECT), admin-read only behind `requireRole(pm/super/
procurement)`, never on a site_admin screen; the field records check-out/check-in
(triggering the rate snapshot server-side) but never SEES the rate — exactly the
`log_labor_day` / `labor_logs.day_rate_snapshot` posture. `wp_equipment_sell` /
`wp_profit` are super_admin/project_director economics reads.

### Tests

- **pgTAP — new file `105-equipment-usage-logs.test.sql`** (RED first, before
  `db:push`): table catalog + columns/types + CHECK; the **anti-grant** on
  `daily_rate_snapshot` (`has_column_privilege` false for `authenticated`, other
  columns true); RLS enabled; **no insert/update/delete grant**; append-only
  (UPDATE/DELETE → `P0001`); `check_out_equipment` gate (visitor → `42501`;
  site_admin allowed), unpriced item → `P0001`, complete WP → `P0001`, double-open
  → `P0001`, happy path inserts an open row + snapshots the rate; `check_in_equipment`
  closes via supersede (open row superseded, closed successor current), in-before-out
  → `P0001`, re-check-in of a closed/superseded row → `P0001`; `wp_equipment_sell`
  gate (super/director only; pm/site_admin/visitor → `42501`), the day-count math
  (closed span inclusive; open checkout accrues to `current_date`), unknown WP →
  `P0001`; `wp_profit` now `equipment_cost = wp_equipment_sell`, `equipment_costed =
true`, profit subtracts equipment.
- **Update `102-wp-profit.test.sql`:** flip the WP-A `equipment_costed = false`
  assertion to `true` (the mechanism now exists; a WP with no usage logs has
  `equipment_cost = 0` but IS costed — profit unchanged at 3200).

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:push` then `pnpm db:test`
green; `pnpm db:types` regenerated (app + worker). **No user-visible change** (no UI
this unit). pgTAP carries correctness; the RPC writes are **verified-by-checklist**
(auth-gated, CHECK-guarded, pgTAP-covered).

### Seams

- **Correction / cancel** of a usage log (`correct_equipment_usage`, supersede with
  a required reason / tombstone) — not built; the `superseded_by` + nullable
  `correction_reason` columns are in place for it.
- **Frozen `wp_equipment_costs`** + `freeze_wp_equipment_cost` (the old U4) — for
  budget-vs-spend + a WP-dimensioned equipment GL posting (so equipment reconciles
  to the GL like materials). Deferred; the live `wp_equipment_sell` covers the
  `wp_profit` need now.
- **Bulk / quantity checkout** (a `quantity` on the usage log for bulk-tracked
  items) — one unit per checkout now; the bulk-split reconciliation seam.
- **Half-day / hourly** — whole-day billing now (operator pick); a `day_fraction`
  refinement is a seam if short checkouts ever need it.
