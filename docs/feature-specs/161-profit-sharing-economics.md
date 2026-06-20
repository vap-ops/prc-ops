# Spec 161 — Profit-sharing economics (the WP profit engine + Nova coins)

Implements **[ADR 0060](../decisions/0060-project-profit-sharing-nova-coins.md)**
(Accepted 2026-06-20) — the self-governance economic engine, built on the Stage-0
spine ([spec 160](160-worker-ecosystem-foundation-stage-0.md): DC-as-person, the coin
ledger, the portal home). Every economic **dial is editable data seeded with a
default** (operator tunes live — the "tune before build" requirement), never a
hardcoded constant. WP P&L + sell rates are **baht** (real money); **Nova coins** are
the separate reward layer (abstract points, per-item shop pricing — no baht peg) that
settles from banked baht profit at project close.

## Units (roadmap)

- **U1 — per-level rate foundation (THIS unit).** Worker **skill level** (Senior /
  Mid / Junior / Apprentice) + the editable **sell-rate table** (per level: baht cost
  band · internal-WP sell · external-WP sell), seeded with defaults. The dials the WP
  P&L will read.
- **U2 — WP as a profit center.** `work_packages.budget` (PD sets) + `is_external`
  flag + the **HT (Head Technician)** assignment (one promoted DC per project,
  exclusive WP owner).
- **U3 — WP profit engine.** `profit = budget − (equipment rental + DC labor @ SELL +
materials)`; bank per WP at completion. Reconciles to the GL (ADR 0057), not a
  second costing path.
- **U4 — project settlement.** At project close: sum banked WP profits × the editable
  **project multiplier** → the coin pool.
- **U5 — coin distribution.** HT cut (editable %) + split by level weight
  (internal > external; externals invisible-locked) → posts to the `coin_postings`
  ledger (spec 160 U2).
- **U6 — Nova shop + saver's bonus + vesting/confiscation.** Per-item coin pricing;
  saver's bonus (editable rate); **narrow** confiscation list; the post-warranty
  **vesting tail** (vested coins are the worker's to keep — ADR 0060 trust posture).

Built strictly in order; each is its own unit. Coin **value** stays abstract (points);
**markup %** calibration waits on real utilization data (ADR 0060 open dial).

## U1 detail — worker levels + the editable sell-rate dials

ADR 0060 §2: **DC pay (cost) is per individual; sell price is per LEVEL** — a small
editable rate table, "the company always keeps the markup." Internal WP charges the
**lower** sell; external WP the **higher**. This unit builds the level attribute + the
seeded rate table; nothing reads it yet (U3 does).

- **Migration (additive):**
  - `worker_level` **enum** = `('senior', 'mid', 'junior', 'apprentice')` (ADR 0060
    §1; "set to change" → values evolve via `add value`).
  - `workers.level public.worker_level null` — the worker's grade (null = unrated;
    assigned going forward). It is a **category, not money** → `grant select (level)`
    to authenticated (like `worker_type`).
  - **`set_worker_level(p_worker, p_level)`** — SECURITY DEFINER, **super_admin** only
    (grading is an operator decision on objective criteria — the anti-favoritism
    pillar, ADR 0060 §5) → else `42501`; validates worker exists (P0001); sets
    `workers.level`; audits (`worker_change`, `payload.kind='level_change'` — reuses
    the action, no enum-add).
  - **`sell_rate_table`** — one row per level: `level public.worker_level PRIMARY KEY`,
    `cost_band`, `internal_sell`, `external_sell` (all `numeric(20,4)`), `updated_by`,
    `updated_at`. **MONEY posture** (sell prices = margin-sensitive): RLS on,
    `revoke all` — **zero authenticated grant**; the operator surface reads it via the
    admin client behind `requireRole(super_admin)` (the `day_rate` posture, spec 46).
    **Seeded** with recommended defaults (operator retunes in-app):

    | level      | cost_band | internal_sell | external_sell |
    | ---------- | --------- | ------------- | ------------- |
    | senior     | 650       | 800           | 950           |
    | mid        | 550       | 700           | 850           |
    | junior     | 450       | 580           | 720           |
    | apprentice | 380       | 480           | 600           |

  - **`set_sell_rate(p_level, p_cost_band, p_internal_sell, p_external_sell)`** —
    SECURITY DEFINER, **super_admin** only → else `42501`; non-negative amounts
    (P0001); updates the level's row (`updated_by = auth.uid()`, `updated_at = now()`);
    audits the change (action `update`, `target_table='sell_rate_table'`, payload
    old/new — generic action, no enum-add).
  - **No `project_manager` in any gate** → the ADR 0058 invariants (pgTAP 90/91) are
    not triggered (super_admin-only is intentional — leveling + rates are operator
    economics).

### U1 TDD

**pgTAP** `98-sell-rate-foundation.test.sql`: catalog (`worker_level` enum labels;
`workers.level` column + type; `sell_rate_table` table + columns; `level` is the PK);
**seed** (4 rows, the default values present); **money posture** (authenticated has no
SELECT on `sell_rate_table`); `set_worker_level` sets the grade + audits, gate
(super passes; pm / visitor → 42501; unknown worker → P0001); `set_sell_rate` updates
a level's rates + audits, gate (super passes; pm → 42501; negative → P0001).

## U1 Scope — OUT (later units)

- Anything that **reads** the rates (the WP P&L) — **U3**.
- WP budget / `is_external` / HT — **U2**. Coin distribution — **U5**.
- A per-worker individual **cost** field distinct from the level cost band (the model
  says cost is per-individual; the worker's `day_rate` already carries it — wiring
  cost into the P&L is U3, not a new column here).
- Rate-change **history** beyond the current editor + the audit row (append-only rate
  history, if needed, is a later refinement).
