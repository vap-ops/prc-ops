# Spec 314 — Technician default pay + level-standard rate (with WHT)

**Status:** design approved (brainstorming, 2026-07-13). Epic — 4 build units (U1–U4) + a deferred U5 (GL). Needs a new ADR (0082).

## Context

The operator's rule: **"All technicians default to รายวัน (daily) with the standard rate for their skill level."**

Today the app does **neither**:

- **pay_type has no default.** The `pay_type` enum is `{monthly, daily}`. At worker approval (`approve_crew_registration`) the approver passes `p_pay_type` explicitly; `workers.pay_type` has no daily default and the UI does not preselect one.
- **No standard rate per skill level.** `worker_level` (`senior | mid | junior | apprentice`) exists on `workers.level`, but it is **decoupled from money on purpose** (ADR 0060 §5 anti-self-dealing — a disinterested back-office sets money, it is not auto-derived). A worker's `day_rate` is either the crew-flat `crews.default_day_rate` or a manual number. Level never drives rate.

`day_rate` is MONEY (zero authenticated grant, service-role read only). It is frozen into `labor_logs.day_rate_snapshot` at log time — the snapshot is the source of truth for pay, never the live worker row (ADR 0009 immutability).

**Reconciliation with ADR 0060.** Deriving rate from a **procurement-manager-maintained standard table** does not violate anti-self-dealing: the rate is authored by a disinterested back-office role (PM), not self-set by the worker or their lead. That is exactly the property ADR 0060 §5 protects. This spec makes the derivation explicit; a new ADR (0082) records it.

## Goals / Non-goals

**Goals**

- A firm-wide **standard day-rate per skill level** (4 rows), maintained by the procurement manager. Rates are **never hardcoded** — seeded blank, PM fills them.
- Each level's standard rate is entered as **before** or **after** withholding tax (WHT), defaulting to **after**.
- A single firm-wide, PM-editable **WHT %**, seeded **3.00** (Thai service-labor default; PM can change).
- New technicians **default to `daily`** pay (overridable to `monthly`).
- At the cost-confirm gate, a worker's `day_rate` **auto-fills from the standard for their level** (gross), unless overridden afterward.
- Payroll **computes and displays** gross / WHT / net, from a **WHT % frozen at log time**.

**Non-goals (deferred)**

- **U5 — GL posting** of WHT-payable liability + gross labor expense (new 2xxx account, outbox posting). Separate spec; danger-path.
- Per-project or per-work-category rates (chosen: firm-wide). Per-worker WHT % (chosen: one firm %; a below-threshold worker is handled by a per-worker override rate, not a per-worker %).
- Approval workflow changes; the ADR 0079 crew-onboarding staging is untouched.

## Design decisions

### D1 — Firm-wide standard rate table, one row per level

`worker_level_rates`: one row per `worker_level`. Firm-wide (not per-project/category). Per-worker exceptions remain possible via the existing `set_worker_day_rate` override.

### D2 — Canonical stored `day_rate` is GROSS

Everywhere a rate is stored on a worker or snapshotted on a labor log, it is **gross** (before WHT). The before/after **basis** is a property only of how the PM *entered* the standard rate; it is consumed once, at gross-up time, and does not travel downstream. This keeps every money column one consistent meaning and lets payroll split gross → WHT/net with only the WHT %.

- `before_wht`: gross = entered_rate.
- `after_wht`: gross = entered_rate ÷ (1 − wht_pct/100).
- If the firm `wht_pct` is NULL, treat it as 0 for gross-up (before/after collapse to entered_rate; no WHT withheld) until the PM sets it.

### D3 — WHT basis per level; WHT % firm-wide

`wht_basis` (`before_wht | after_wht`, default `after_wht`) lives **per row** on `worker_level_rates` (operator chose per-level). The WHT **percentage** is a single firm-wide value in a `labor_wht_config` singleton (operator chose one firm %). Both PM-editable, both seeded blank/default.

### D4 — Derivation fires once, at the cost-confirm gate

`confirm_worker_cost` (super_admin, the existing money choke point that sets `level` and stamps `cost_confirmed_at`) additionally sets `workers.day_rate = level_gross_rate(level)` **when a standard exists** for that level, else leaves the existing `day_rate` untouched. A non-standard rate is a deliberate `set_worker_day_rate` override **after** confirm. `set_worker_level` (re-level) does **not** touch `day_rate` — re-pricing is deliberate, never a silent side effect of re-leveling. (Both RPCs verified against their live definitions at U3 build.)

### D5 — pay_type defaults to daily, overridable

Three layers so the default holds regardless of entry path: `workers.pay_type` column default `'daily'`; `approve_crew_registration.p_pay_type` default `'daily'`; the approval UI preselects daily. Monthly stays selectable.

### D6 — Freeze the WHT % at log time (immutability)

`labor_logs` gains `wht_pct_snapshot numeric`. `log_labor_day` snapshots the current firm `wht_pct` at insert (alongside `day_rate_snapshot`); `correct_labor_log` **copies** the original row's snapshot (same rule the correction path already uses for `day_rate_snapshot`). A later change to the firm WHT % therefore never restates a worked day. Pre-feature rows and rows logged while `wht_pct` is NULL carry `wht_pct_snapshot = NULL` → payroll treats WHT as 0, net = gross (backward-compatible).

### D7 — Money columns keep the zero-grant posture

`worker_level_rates.entered_rate`, any derived gross, `labor_wht_config.wht_pct`, and `labor_logs.wht_pct_snapshot` get **no authenticated grant** — service-role read only, like `workers.day_rate` and `labor_logs.day_rate_snapshot`. Writes only via DEFINER RPCs. The rate table's non-money columns (`level`, `wht_basis`, `active`) may be authenticated-readable so the settings UI can render the grid; the rate value is fetched service-side.

### D8 — Editing the standard table does not retro-rewrite workers

Setting a standard rate affects only **future** derivations (the next `confirm_worker_cost`). Existing workers keep their `day_rate`; existing labor logs keep their snapshots. Consistent with the snapshot doctrine. A bulk "re-apply standard" is out of scope.

## Data model

New enum: `public.wht_basis` = `('before_wht', 'after_wht')`.

### `worker_level_rates` (firm-wide standard, PM-maintained)

| column         | type              | notes                                                        |
| -------------- | ----------------- | ------------------------------------------------------------ |
| `level`        | `worker_level` PK | one row per enum value; seeded for all 4 current values      |
| `entered_rate` | `numeric(10,2)`   | nullable — seeded NULL; the figure the PM typed; **money**   |
| `wht_basis`    | `wht_basis`       | not null, default `after_wht`                                |
| `active`       | `boolean`         | not null, default true                                       |
| `updated_by`   | `uuid → users.id` | nullable                                                     |
| `updated_at`   | `timestamptz`     | not null, default now()                                      |

RLS on. `select (level, wht_basis, active, updated_at)` to authenticated; **no grant on `entered_rate`**. Writes RPC-only.

### `labor_wht_config` (firm-wide WHT %, singleton)

| column       | type              | notes                                                            |
| ------------ | ----------------- | ---------------------------------------------------------------- |
| `id`         | `boolean` PK      | `default true check (id)` — classic single-row guard             |
| `wht_pct`    | `numeric(5,2)`    | nullable; percent, e.g. `3.00`; `check 0 ≤ x < 100`; **money-adjacent, no auth grant** |
| `updated_by` | `uuid → users.id` | nullable                                                         |
| `updated_at` | `timestamptz`     | not null, default now()                                          |

Seeded with one row (`id = true`, **`wht_pct = 3.00`** — the Thai service-labor default; PM-editable). Kept nullable so the PM can clear it; a NULL `wht_pct` degrades to 0% gross-up per D2.

### `labor_logs` — additive column

`wht_pct_snapshot numeric(5,2)` nullable, **no authenticated grant**. Snapshotted by `log_labor_day`, copied by `correct_labor_log`.

## RPCs (all DEFINER, `set search_path = public`, audited)

- `set_level_rate(p_level worker_level, p_entered_rate numeric, p_basis wht_basis)` — upsert one level's rate + basis. Gate: `procurement_manager`, `super_admin`. `revoke ... from anon`. Rejects negative rate.
- `set_labor_wht_pct(p_pct numeric)` — set the firm WHT %. Same gate. Rejects `< 0` or `≥ 100`.
- `level_gross_rate(p_level worker_level) returns numeric` — helper: reads `entered_rate` + `wht_basis` for the level and the firm `wht_pct`; returns the **gross** per D2, or NULL if `entered_rate` is NULL. DEFINER (reads no-grant money); callable by the confirm RPC. Not granted to anon; not a client surface.
- `confirm_worker_cost` — **amended** (D4): after setting `level`, `update workers set day_rate = coalesce(level_gross_rate(p_level), day_rate)` before the cost-confirmed stamp. Re-source from the live definition (do not edit the original migration).
- `log_labor_day` / `correct_labor_log` — **amended** (D6): add `wht_pct_snapshot`. Re-source from live definitions.
- `approve_crew_registration` — **amended** (D5): `p_pay_type` default `'daily'`.

## Payroll math (U4)

In `src/lib/labor/payroll.ts`, per current daily row, using the frozen snapshot:

```
grossPerDay = day_rate_snapshot
whtPerDay   = round2(grossPerDay × (wht_pct_snapshot ?? 0) / 100)
netPerDay   = grossPerDay − whtPerDay
days        = fractionDays(day_fraction)
```

Roll up per worker: `gross`, `wht`, `net` (all × days). `day_rate_snapshot` stays the gross source of truth. The payroll page and CSV export gain **gross / WHT / net** columns (money format via `src/lib/format.ts` SSOT). `round2` from `format.ts`.

## Units

- **U1 — schema + config + RPCs.** `wht_basis` enum; `worker_level_rates` (+ seed 4 rows NULL); `labor_wht_config` (+ seed 1 row NULL); grants/RLS; `set_level_rate`, `set_labor_wht_pct`, `level_gross_rate`. Migration `075784`+ (verify live head at build). pgTAP: gates, gross-up math (before/after/NULL-pct), zero-grant. **Additive migration — self-mergeable on green under the standing grant.**
- **U2 — PM settings UI.** `/settings/labor-rates` under the ทีมช่าง (`labor-team`) settings section: 4-level grid (rate + basis per level) + firm WHT% field. Edit gated to `procurement_manager` + `super_admin`. New labels in `labels.ts` (shared SSOT — coordinate the lane). Code-only.
- **U3 — defaulting + snapshot.** D5 (pay_type default daily, 3 layers) + D4 (`confirm_worker_cost` derives `day_rate`) + D6 (`labor_logs.wht_pct_snapshot` + `log_labor_day`/`correct_labor_log`). Migration + RPC replaces — **danger-path (money/labor RPCs), operator-held merge.**
- **U4 — payroll compute + UI.** `payroll.ts` gross/WHT/net + page + CSV columns. Touches payroll (money) — danger-path guard will hold; operator-merged.
- **U5 — DEFERRED (separate spec).** GL posting of WHT-payable + gross labor expense.

## Security / invariants honored

- Zero-grant money columns; DEFINER-only writes; `revoke execute ... from anon` on every new RPC (spec 284 lesson).
- Snapshot/immutability: frozen `day_rate_snapshot` (gross) + frozen `wht_pct_snapshot`; a later config change never restates history.
- Worker = payee (ADR 0062); ADR 0079 crew staging untouched; ADR 0060 anti-self-dealing preserved (rate authored by PM table).
- `worker_level` is the SSOT for levels; `worker_level_rates` seed must track the enum — growing the enum (via ADR) must seed a new rate row (guard in U1 pgTAP).

## Resolved (operator, 2026-07-13)

1. **WHT default value** → seed `wht_pct = 3.00` (Thai service-labor default), PM-editable.
2. **Re-level re-pricing** → confirmed: `set_worker_level` leaves `day_rate` untouched; only `confirm_worker_cost` derives.
3. **Existing workers' rate basis** → roster currently empty (mock crew deleted, awaiting real crew), so no legacy rate data; rates entered going forward are gross (full/pre-tax). No data migration.
