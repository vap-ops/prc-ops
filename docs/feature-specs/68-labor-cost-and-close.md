# Spec 68 — Labor P2: cost freeze, PM cost view, close-out variance

**Status:** in progress — 2026-06-13. **Type:** money + close-out. **DB
migration** (prod) — gated on explicit operator confirmation before
`pnpm db:push` (see Execution gate).

Implements the **P2** block deferred in [spec 46](46-daily-labor-capture.md)
(§"P2 — money & close"), with the data model red-teamed below. Spec 46 P1
shipped the capture machinery (`workers`, `labor_logs`, the log/correct RPCs,
the presence-only field zone). This unit turns logged days into **cost** and
closes the loop the CEO review (§3 "Now" #1) names as the next dev move — the
Head Tech surplus-share pilot, an internal _paying_ use case, waits on it.

## Why this is the unit

- Labor is captured but **pays nobody yet** (CEO review threat #2,
  reversion-by-stall). Cost-per-WP is the artifact the surplus-share pilot
  runs on; billing status (spec 69, gated on an operator per-WP/deliverable
  decision) follows it.
- All the operator stress-test calls are already resolved (spec 46 C1–C7);
  nothing here needs a new operator decision before building.

## Money posture (the security spine — unchanged from P1)

Field UI stays **presence-only**: no rate, cost, or total on any screen a
`site_admin` can reach. The enforcement is the **column grant**, not
discipline — `labor_logs.day_rate_snapshot` and the entire `wp_labor_costs`
table have **zero `authenticated` grant**, so a money read is a `42501` for
every field session regardless of what code asks for. Cost is computed and
rendered **only** on the PM WP-detail page (`/pm/work-packages/[id]`, already
`requireRole(['project_manager','super_admin'])`), via the **service-role
admin client** — the same authorized-escalation pattern the page already uses
for decider names (`page.tsx:88`). The SA WP-detail page
(`site_admin`-reachable) gets **no** cost rendering, ever — not even for a
pm/super viewer.

## Data model (red-teamed)

### `wp_labor_costs` — the frozen snapshot (deliberately mutable)

```
work_package_id  uuid  PRIMARY KEY → work_packages(id)
own_cost         numeric(12,2)  NOT NULL
dc_cost          numeric(12,2)  NOT NULL
computed_at      timestamptz    NOT NULL DEFAULT now()
frozen_by        uuid  NOT NULL → users(id)
```

- **One row per WP, mutable** (UPSERT on re-freeze) — NOT append-only. This is
  a "deliberately mutable" table (outbox / WP-metadata precedent), justified
  because the **audit_log** carries the change history (old/new cost in the
  payload). C6: "later corrections never recompute it silently — PM re-freezes
  explicitly, audited." So a correction to a `labor_log` after close does
  **not** touch this snapshot; the snapshot only moves when a pm/super calls
  the freeze RPC (auto on approve→complete, or the explicit re-freeze button).
- **RLS enabled, zero grant, no policies** — every table has RLS (CLAUDE.md);
  with zero `authenticated` grant there is nothing to write a policy for. Read
  path is the admin client (bypasses RLS) behind `requireRole`.

### `freeze_wp_labor_cost(p_wp uuid) returns void` — SECURITY DEFINER

Mirrors `set_worker_day_rate` (role gate + audit write, `workers.sql:147`):

- `set search_path = public`; role gate `current_user_role() in
('project_manager','super_admin')` else **42501**. (Note: `site_admin` is
  refused — rate is money, same as `set_worker_day_rate`.)
- WP-existence probe → **P0001** if absent (SECURITY DEFINER bypasses RLS;
  but v1 access is role-level per ADR 0013 so existence is the only probe —
  same posture as `record_site_purchase`).
- Compute from **current** (`day_fraction is not null` AND not superseded)
  `labor_logs` for the WP: `own_cost = Σ fraction × day_rate_snapshot` where
  `worker_type_snapshot='own'`; `dc_cost` likewise for `'dc'`. `fraction` =
  `full→1.0, half→0.5`.
- `INSERT … ON CONFLICT (work_package_id) DO UPDATE` (the upsert).
- **One** `audit_log` row, `action='labor_cost_freeze'`, payload
  `{own_cost, dc_cost, old_own_cost, old_dc_cost}` (old = NULL on first
  freeze). Reuses the `set_worker_day_rate` audit shape; **new audit_action
  value** `labor_cost_freeze`.
- `revoke … from public, anon; grant execute … to authenticated`.

### Invocation — via the **authenticated** session, never the admin client

`current_user_role()` reads `role from public.users where id = auth.uid()`.
Under the **service-role** admin client `auth.uid()` is NULL → the gate raises 42501. So the freeze is invoked through the **caller's authenticated session**
(`supabase.rpc`), whose JWT yields `project_manager` and a real `auth.uid()`
for `frozen_by`/the audit actor. The RPC is SECURITY DEFINER, so it still
writes the zero-grant table. Two call sites, both authenticated:

1. **Auto** — in `recordDecision` (`pm/.../actions.ts`), immediately after the
   admin UPDATE flips the WP to `complete` (`actions.ts:122`), via
   `supabase.rpc('freeze_wp_labor_cost', { p_wp })`. **Non-fatal**: log on
   error, never fail the approve (C6 makes a missed freeze recoverable). The
   approve transition itself stays admin-escalated and untouched.
2. **Explicit re-freeze** — `refreezeWpLaborCost(workPackageId)` server action
   (requireRole pm/super, authenticated `supabase.rpc`), behind a button in
   the cost view shown when the live computed cost drifts from the frozen
   snapshot.

### `labor_cost_freeze` audit_action — its own migration

`ALTER TYPE … ADD VALUE` cannot be referenced in the transaction that adds it,
so the value lands in migration A (own txn) and the RPC that uses it in
migration B. **Enum pins to update (grep-all-enum-pins lesson — broke 3 files
when `worker_change` landed): `03-audit-log-shape`, `18-appsheet-writer-
purchasing`, `19-on-route-status`** all carry a full-label `enum_has_labels`
on `audit_action`.

## App layer — pure helpers (TDD, unit-tested first)

- `src/lib/dates.ts`: add `bangkokDateOf(iso: string): string` — an ISO
  timestamp → `YYYY-MM-DD` in Asia/Bangkok (the `en-CA`/`Intl.DateTimeFormat`
  pattern already in the file). Pure.
- `src/lib/labor/cost.ts`:
  - `fractionDays(f: DayFraction): number` (`full→1`, `half→0.5`).
  - `aggregateLaborCost(rows)` — takes full labor rows (incl.
    `day_rate_snapshot`, `worker_type_snapshot`, `day_fraction`,
    `superseded_by`, `id`, `worker_id`, `worker_name_snapshot`, `work_date`,
    `self_logged`); applies the current-state filter; returns
    `{ ownCost, dcCost, total, workers: [{ workerId, name, type, days, cost,
selfLogged }], laborDays: string[] }`.
  - `findOverAllocatedDays(crossRows)` — current-state group by
    `(worker_id, work_date)`, sum fractions, return the pairs where
    `total > 1.0` (C5 cross-WP over-allocation). Pure.
- `src/lib/labor/variance.ts`:
  - `LABOR_VARIANCE_MIN_DIFF = 2` (named threshold).
  - `computeLaborVariance(photoDays: string[], laborDays: string[])` →
    `{ photoOnlyDays, laborOnlyDays, symmetricDiff, photosWithoutLabor,
surfaces }`. `surfaces = symmetricDiff >= LABOR_VARIANCE_MIN_DIFF ||
(photoDays.length > 0 && laborDays.length === 0)`.

## App layer — reads & actions

- PM page (`pm/work-packages/[workPackageId]/page.tsx`): after `requireRole`,
  an admin-client read of (a) this WP's full `labor_logs` (money columns), (b)
  the `wp_labor_costs` snapshot, (c) cross-WP current `labor_logs` for the
  `(worker_id, work_date)` pairs on this WP (for >1.0 surfacing). Photo days
  derive from the already-loaded current photos (`captured_at_client ??
created_at`, `bangkokDateOf`). Compute via the pure helpers; pass aggregates
  to the view.
- `src/lib/labor/actions.ts`: add `refreezeWpLaborCost`.
- `database.types.ts`: hand-extend — `wp_labor_costs` Row/Insert/Update, the
  `freeze_wp_labor_cost` Functions entry, `'labor_cost_freeze'` in the
  `audit_action` union **and** the `Constants` array. Reconcile byte-for-byte
  with `db:types` after the real push.

## UI — PM cost view + variance (PM page only)

- `LaborCostView` (Server Component, money rendered server-side): own/DC
  subtotals + grand total (baht), a per-worker list (name, own/DC, day count,
  cost, self-log flag), and the >1.0 over-allocation flags. Uses
  `classes.ts` (`CARD`, `SECTION_HEADING`); Thai labels. Renders only when at
  least one labor row or a frozen snapshot exists.
- Frozen-vs-live: show the snapshot (`own/dc/total`, `computed_at`,
  frozen-by name); when live ≠ frozen, an amber note + a small client
  `RefreezeButton` (`refreezeWpLaborCost`, `useTransition`). Re-freeze is
  recomputable + audited → not "destructive", so a plain pending button (no
  ConfirmDialog).
- Variance strip: `AttentionCard` tone `amber`, rendered only when
  `computeLaborVariance(...).surfaces` — "ภาพถ่ายกับวันลงแรงงานไม่ตรงกัน"
  with the photo-only / labor-only day counts.
- New-code doctrine: `classes.ts` constants, `min-h-11` button,
  labels via Thai strings/`labels.ts`, no `window.confirm`.

## Tests (TDD — failing first)

- **Unit:** `bangkokDateOf` (UTC-midnight boundary → next Bangkok day);
  `fractionDays`; `aggregateLaborCost` (own/dc split, superseded + tombstone
  excluded, mixed rates per worker, self-log roll-up); `findOverAllocatedDays`
  (exactly 1.0 not flagged, >1.0 flagged, cross-WP sum); `computeLaborVariance`
  (symmetric-diff threshold boundary at 1 vs 2; photos-with-zero-labor arm;
  both-empty → no surface).
- **pgTAP — new file `34-wp-labor-costs.test.sql`:** `wp_labor_costs` shape;
  **zero authenticated grant** (authenticated `select` → 42501; no write);
  `freeze_wp_labor_cost` — pm happy-path writes the correct own/dc from
  seeded logs + **one** `labor_cost_freeze` audit row; **site_admin and
  visitor refused 42501**; WP-not-found → P0001; **re-freeze** upserts (one
  row, second audit row, old values in payload); cost **excludes** superseded
  - tombstone logs. `_tap_buf` grant + `reset role` before `finish()`
    (file-10/26 pattern).
- **Update broken pins (same unit):** the `audit_action` `enum_has_labels`
  array in files **03, 18, 19** (add `labor_cost_freeze`; plan counts
  unaffected — it's one assertion each).

## Verification

1. `pnpm lint && pnpm typecheck && pnpm test` green (hand-extended types).
2. `pnpm build` green (placeholder env).
3. **Gate → operator confirms →** `pnpm db:push` (prod) → `pnpm db:types` →
   reconcile vs the hand extension → `pnpm db:test` (linked DB) all green.
4. Acceptance = operator: approve a WP that has logged days → snapshot freezes;
   open the PM cost view (own/DC subtotals, a >1.0 worker if seeded, self-log
   flags); correct a day after close → live-vs-frozen drift shows + re-freeze;
   confirm the SA screen shows **no** money anywhere.

## Execution gate (prod safety)

Build everything locally — migrations + pgTAP + app — green against
hand-extended types, then **STOP and confirm with the operator before
`pnpm db:push`**. Code referencing the new schema must not deploy before the
migration is applied (the `main` push auto-deploys Vercel); migration first.

## Recorded seams (not in this unit)

- Billing status per WP/deliverable (the displaced "spec 47" → **spec 69**),
  gated on the operator's per-WP-vs-`งวดงาน` decision (CEO review §3 #2).
- Payroll export of DC days (spec 46 recorded seam).
- A PM "WPs awaiting freeze / with post-close drift" queue (today the drift
  shows per-WP on the detail page, a pull not a push).
- Capturing labor against the report PDF (cost line on the owner-facing
  artifact) — own spec when billing lands.
