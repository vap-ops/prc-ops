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
